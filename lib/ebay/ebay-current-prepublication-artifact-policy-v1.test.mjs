import test from "node:test"
import assert from "node:assert/strict"
import { bindCurrentPrepublicationArtifactAuthorityV1 as bind,
  evaluateCurrentPrepublicationArtifactPolicyV1 as evaluate,
  readCurrentPrepublicationArtifactAuthorityV1 as read } from
  "./ebay-current-prepublication-artifact-policy-v1.ts"
import { readFileSync } from "node:fs"

const truth = `sha256:${"a".repeat(64)}`
function fixture() {
  const accountKey = `production:${"b".repeat(64)}`
  const listingPackage = { id: "package", opportunity_id: "opportunity",
    candidate_key: "candidate", created_by: "actor", account_key: accountKey,
    package_data: { categoryId: "261987", conditionId: "1000",
      aspects: { Brand: "Unbranded", Style: "Cuff", Type: "Bracelet" },
      pricing: { targetPrice: 17.77, currency: "USD" },
      currentPublicationFactoryV1: { version:
        "SELLER_OS_CURRENT_PUBLICATION_FACTORY_V1", authorityPolicy:
        "CURRENT_ONLY", reuseLegacyPreparation: false, packageId: "package",
        accountKey, productId: "product", variantId: "variant",
        supplierSku: "supplier", generation: "generation" },
      packageExposurePolicyV1: { version:
        "SELLER_OS_PACKAGE_LISTING_EXPOSURE_V1", status: "ACTIVE",
        sourcePolicy:
        "SELLER_OS_CURRENT_FACTORY_ROUTINE_EXPOSURE_AUTHORITY_V1",
        quantity: 1, supplierQuantityInferred: false,
        publicationAuthorized: false, binding: { accountKey,
          packageId: "package", productId: "product", variantId: "variant",
          sku: "supplier", productTruthDigest: truth } },
      conditionAuthority: { factInvented: false, lunaProductId: "product",
        lunaVariantId: "variant", supplierSku: "supplier",
        categoryId: "261987", conditionId: "1000" } } }
  const opportunity = { id: "opportunity", candidate_key: "candidate",
    supplier_product_id: "product", supplier_variant_id: "variant",
    supplier_sku: "supplier", assessment: { productTruth: {
      evidenceDigest: truth }, canonicalMarketplaceReadinessV1: {
      productTruthDigest: truth, ready: true, listingPolicyReady: true,
      requiredItemSpecificsReady: true } } }
  const accountProfile = { account_key: accountKey,
    marketplace_id: "EBAY_US", fulfillment_policy_id: "fulfillment",
    payment_policy_id: "payment", return_policy_id: "returns",
    merchant_location_key: "location", selected_by: "actor",
    verified_at: "2026-09-12T00:00:00Z",
    expires_at: "2026-09-13T00:00:00Z" }
  return { listingPackage, opportunity, accountProfile, accountKey,
    now: new Date("2026-09-12T01:00:00Z") }
}

test("CURRENT policy allows only exact non-public prepublication artifacts", () => {
  const result = evaluate(fixture())
  assert.equal(result.pass, true)
  assert.deepEqual(result.authority.permittedOperations,
    ["createOrReplaceInventoryItem", "createOffer"])
  assert.equal(result.authority.publicationCommitAllowed, false)
  assert.equal(result.authority.publicMarketplaceExposureAllowed, false)
  assert.equal(result.authority.blindRetryAllowed, false)
  assert.equal(result.authority.codexRuntimeDependency, false)
  assert.equal(result.draftConfiguration.quantity, 1)
  assert.equal(result.draftConfiguration.condition, "NEW")
})

test("authority is durable, exact and tamper evident", () => {
  const result = evaluate(fixture())
  assert.equal(result.pass, true)
  const payload = bind({ compliance: { retained: true } }, result.authority)
  assert.equal(read(payload)?.packageId, "package")
  const changed = structuredClone(payload)
  changed.compliance.currentPrepublicationArtifactAuthorityV1.packageId =
    "another-package"
  assert.equal(read(changed), null)
})

test("explicit unproven market price cannot enter the artifact writer", () => {
  const input = fixture()
  input.listingPackage.package_data.quickPickMarketTestPackageV1 = {
    marketPriceSupport: "UNPROVEN" }
  const result = evaluate(input)
  assert.equal(result.pass, false)
  assert.ok(result.blockers.includes("MARKET_PRICE_SUPPORT_NOT_PROVEN"))
})

test("CURRENT same-link reentry is not downgraded by greenfield market-test state", () => {
  const input = fixture()
  input.listingPackage.package_data.currentPublicationFactoryV1
    .historicalReferences = [{ use: "AUDIT_LINEAGE_DEDUP_ONLY",
      packageId: "historical" }]
  input.opportunity.assessment.marketTestReviewV1 = {
    marketPriceSupport: "UNPROVEN" }
  assert.equal(evaluate(input).pass, true)
})

test("selected physical greenfield remains held until CURRENT proof exists", () => {
  const input = fixture()
  input.listingPackage.package_data.currentPublicationFactoryV1
    .historicalReferences = [{ use: "AUDIT_LINEAGE_DEDUP_ONLY",
      packageId: "historical" }]
  input.opportunity.supplier_sku = "FL-NH4771198"
  input.listingPackage.package_data.currentPublicationFactoryV1.supplierSku =
    "FL-NH4771198"
  input.listingPackage.package_data.packageExposurePolicyV1.binding.sku =
    "FL-NH4771198"
  input.listingPackage.package_data.conditionAuthority.supplierSku =
    "FL-NH4771198"
  input.opportunity.assessment.market = { marketPriceSupport: "UNPROVEN" }
  assert.ok(evaluate(input).blockers.includes(
    "MARKET_PRICE_SUPPORT_NOT_PROVEN"))
  input.listingPackage.package_data.pricing.marketPriceSupport = "PROVEN"
  assert.equal(evaluate(input).pass, true)
})

test("missing package actor binds to the certified account selector", () => {
  const input = fixture()
  input.listingPackage.created_by = null
  const result = evaluate(input)
  assert.equal(result.pass, true)
  assert.equal(result.actorBindingRequired, true)
  assert.equal(result.authority.actorUserId, "actor")
})

test("legacy or publication-authorized exposure cannot satisfy CURRENT", () => {
  const legacy = fixture()
  delete legacy.listingPackage.package_data.currentPublicationFactoryV1
  assert.equal(evaluate(legacy).pass, false)
  const publicExposure = fixture()
  publicExposure.listingPackage.package_data.packageExposurePolicyV1
    .publicationAuthorized = true
  assert.ok(evaluate(publicExposure).blockers.includes(
    "CURRENT_ROUTINE_EXPOSURE_AUTHORITY_REQUIRED"))
})

test("protected Seller OS runtime continues artifacts without a publish path", () => {
  const route = readFileSync(new URL(
    "../../app/api/admin/ebay/draft-only/route.ts", import.meta.url), "utf8")
  const cron = readFileSync(new URL(
    "../../app/api/cron/quick-pick-runtime-recovery/route.ts",
    import.meta.url), "utf8")
  const readiness = readFileSync(new URL(
    "./ebay-draft-only-readiness.ts", import.meta.url), "utf8")
  const currentRuntime = readFileSync(new URL(
    "../seller-os/sell-one-like-this-runtime-v1.ts", import.meta.url),
    "utf8")
  const revisionPreflight = readFileSync(new URL(
    "./ebay-publication-revision-preflight-readonly-v1.ts",
    import.meta.url), "utf8")
  const migration = readFileSync(new URL(
    "../../supabase/migrations/20260912234500_current_prepublication_artifact_bootstrap_v1.sql",
    import.meta.url), "utf8")
  const start = route.indexOf(
    "async function materializeCurrentPrepublicationArtifactsV1")
  const end = route.indexOf("async function handlePost", start)
  const lane = route.slice(start, end)
  assert.ok(start > 0 && end > start)
  assert.match(lane, /sellerOsPostRuntimeAuthorizedV1/)
  assert.match(lane, /publicationCommitAllowed: false/)
  assert.match(lane, /publicMarketplaceExposureAllowed: false/)
  assert.match(lane, /blindRetryAllowed: false/)
  assert.match(lane, /idempotencyKey: `current-prepub:\$\{digest\}`/)
  assert.match(lane, /prepareCurrentPrepublicationIntentV1/)
  assert.match(lane, /CURRENT_PREPUBLICATION_PRIOR_EXECUTION_NOT_RECONCILED/)
  assert.match(lane, /priorExecutionReused/)
  assert.match(route, /currentArtifactOnly: true/)
  assert.match(route, /persistAccountProfile: false/)
  assert.match(route, /CURRENT_PREPUBLICATION_ACCOUNT_PREFLIGHT_FAILED/)
  assert.match(route, /AUDIT_LINEAGE_DEDUP_ONLY/)
  assert.match(route, /currentAuditLineagePackageIds/)
  assert.match(route, /prepare_current_prepublication_intent_v1/)
  assert.doesNotMatch(lane, /publishEbayOfferOnce|publishFinalPublication/)
  assert.match(cron, /materialize_current_prepublication_artifacts/)
  assert.match(cron, /AbortSignal\.timeout\(240_000\)/)
  assert.match(readiness, /currentArtifactAuthorized/)
  assert.match(currentRuntime,
    /exposurePolicy: prep\.exposurePolicy \?\? pkg\.exposure/)
  assert.match(revisionPreflight, /currentOnlyWithoutReference/)
  assert.match(revisionPreflight, /currentOnlyAuthorityUsed===true/)
  assert.match(revisionPreflight, /legacyKeywordFallback===false/)
  assert.match(migration,
    /CURRENT_PREPUBLICATION_ARTIFACT_BOOTSTRAP_V1/)
  assert.match(migration,
    /currentPrepublicationArtifactAuthorityV1/)
  assert.match(migration, /publicationCommitAllowed' <> 'false'/)
  assert.match(migration, /publicMarketplaceExposureAllowed' <> 'false'/)
  assert.doesNotMatch(migration, /ebay_same_day_pilot_candidates/)
  assert.doesNotMatch(migration, /publish_ebay|claim_ebay_authorized/)
})
