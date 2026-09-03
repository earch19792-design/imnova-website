import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"
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

const policy = await import("./ebay-owner-supplier-merchandise-policy-v1.ts")
const { lunaOwnerCertifiedNewMerchandiseConditionV1 } = await import(
  "./ebay-manual-listing-domain.ts")

const ACCOUNT = "account-test"
const POLICY_ID = "11111111-1111-4111-8111-111111111111"
const AUTHORIZATION_DIGEST = `sha256:${"b".repeat(64)}`

function durablePolicyRow(overrides = {}) {
  return { id: POLICY_ID, marketplace_account_key: ACCOUNT,
    marketplace: "EBAY_US", supplier_code: "LUNA_PORTEX",
    policy_code: "LUNA_ALL_MERCHANDISE_NEW",
    policy_version: "LUNA_ALL_MERCHANDISE_NEW_V1", decision: "CERTIFIED",
    policy_payload: {
      statement: "LUNA PORTEX SOLO VENDE PRODUCTOS NUEVOS.",
      conditionLabel: "New", exactSupplierLineageRequired: true,
      productIdentityExactRequired: true,
    }, evidence_digest: policy.lunaNewMerchandisePolicyDigestV1(),
    authorization_reference_digest: AUTHORIZATION_DIGEST,
    certified_at: "2026-09-02T12:00:00.000Z", revoked_at: null,
    ...overrides }
}

function durableBrandPolicyRow(overrides = {}) {
  return { id: POLICY_ID, marketplace_account_key: ACCOUNT,
    marketplace: "EBAY_US", supplier_code: "LUNA_PORTEX",
    policy_code: "LUNA_UNBRANDED_AFTER_FULL_PAGE_REVIEW",
    policy_version: "LUNA_UNBRANDED_AFTER_FULL_PAGE_REVIEW_V1",
    decision: "CERTIFIED", policy_payload: {
      statement: policy.LUNA_UNBRANDED_AFTER_FULL_PAGE_REVIEW_STATEMENT,
      conditionLabel: null, brandValue: "Unbranded",
      exactSupplierLineageRequired: true,
      productIdentityExactRequired: true,
      fullLunaPageEvidenceRequired: true,
      explicitLunaBrandPreserved: true,
      imageEvidenceReviewRequired: true,
      factInvented: false,
    }, evidence_digest:
      policy.lunaUnbrandedAfterFullPageReviewPolicyDigestV1(),
    authorization_reference_digest: AUTHORIZATION_DIGEST,
    certified_at: "2026-09-03T12:00:00.000Z", revoked_at: null,
    ...overrides }
}

test("the durable Luna policy is exact, account scoped and revocation aware", () => {
  assert.ok(policy.validateLunaNewMerchandisePolicyRowV1(
    durablePolicyRow(), ACCOUNT))
  assert.equal(policy.validateLunaNewMerchandisePolicyRowV1(
    durablePolicyRow(), "other-account"), null)
  assert.equal(policy.validateLunaNewMerchandisePolicyRowV1(
    durablePolicyRow({ revoked_at: "2026-09-03T00:00:00.000Z" }), ACCOUNT),
  null)
  assert.equal(policy.validateLunaNewMerchandisePolicyRowV1(
    durablePolicyRow({ policy_payload: {
      ...durablePolicyRow().policy_payload, conditionLabel: "Used" } }),
  ACCOUNT), null)
})

test("Condition New requires both exact Luna lineage and the exact policy application", () => {
  const durable = policy.validateLunaNewMerchandisePolicyRowV1(
    durablePolicyRow(), ACCOUNT)
  const application = policy.buildOwnerSupplierPolicyApplicationV1({
    policy: durable, lunaProductId: "100", lunaVariantId: "200",
    supplierSku: "LUNA-SKU", exactSupplierLineageCertified: true,
    productIdentityExact: true, appliedAt: "2026-09-02T12:01:00.000Z",
  })
  const result = lunaOwnerCertifiedNewMerchandiseConditionV1({
    exactProductIdentityProven: true, lunaProductId: "100",
    lunaVariantId: "200", supplierSku: "LUNA-SKU", categoryId: "29946",
    policyApplication: application,
  })
  assert.equal(result.conditionLabel, "New")
  assert.equal(result.authority,
    "OWNER_CERTIFIED_LUNA_SUPPLIER_CATALOG_POLICY")
  assert.equal(result.factInvented, false)
  const jsonbReorderedApplication = Object.fromEntries(
    Object.entries(application).reverse())
  assert.equal(policy.validateOwnerSupplierPolicyApplicationV1(
    jsonbReorderedApplication, { lunaProductId: "100",
      lunaVariantId: "200", supplierSku: "LUNA-SKU" }), true)
  assert.equal(lunaOwnerCertifiedNewMerchandiseConditionV1({
    exactProductIdentityProven: true, lunaProductId: "100",
    lunaVariantId: "DIFFERENT", supplierSku: "LUNA-SKU",
    categoryId: "29946", policyApplication: application,
  }), null)
  assert.equal(policy.buildOwnerSupplierPolicyApplicationV1({
    policy: durable, lunaProductId: "100", lunaVariantId: "200",
    supplierSku: "LUNA-SKU", exactSupplierLineageCertified: false,
    productIdentityExact: true,
  }), null)
})

test("the durable Luna no-brand policy is exact and preserves explicit brands", () => {
  const durable = policy.validateLunaUnbrandedAfterFullPageReviewPolicyRowV1(
    durableBrandPolicyRow(), ACCOUNT)
  assert.ok(durable)
  assert.equal(policy.validateLunaUnbrandedAfterFullPageReviewPolicyRowV1(
    durableBrandPolicyRow({ policy_payload: {
      ...durableBrandPolicyRow().policy_payload,
      explicitLunaBrandPreserved: false,
    } }), ACCOUNT), null)
  const application = policy.buildOwnerLunaUnbrandedPolicyApplicationV1({
    policy: durable, lunaProductId: "100", lunaVariantId: "200",
    supplierSku: "LUNA-SKU", exactSupplierLineageCertified: true,
    productIdentityExact: true, appliedAt: "2026-09-03T12:01:00.000Z",
  })
  assert.equal(policy.validateOwnerLunaUnbrandedPolicyApplicationV1(
    application, { lunaProductId: "100", lunaVariantId: "200",
      supplierSku: "LUNA-SKU" }), true)
  assert.equal(policy.validateOwnerLunaUnbrandedPolicyApplicationV1(
    application, { lunaProductId: "100", lunaVariantId: "201",
      supplierSku: "LUNA-SKU" }), false)
  assert.equal(policy.buildOwnerLunaUnbrandedPolicyApplicationV1({
    policy: durable, lunaProductId: "100", lunaVariantId: "200",
    supplierSku: "LUNA-SKU", exactSupplierLineageCertified: true,
    productIdentityExact: false,
  }), null)
})

test("the owner policy table is service-only, RLS protected and immutable except revocation", async () => {
  const migration = await readFile(new URL(
    "../../supabase/migrations/20260903011500_create_owner_supplier_merchandise_policy_v1.sql",
    import.meta.url), "utf8")
  assert.match(migration, /enable row level security/i)
  assert.match(migration, /revoke all[\s\S]+from anon, authenticated/i)
  assert.match(migration, /grant select, insert, update[\s\S]+to service_role/i)
  assert.match(migration, /OWNER_SUPPLIER_POLICY_APPEND_ONLY/)
  assert.match(migration, /old[.]revoked_at is null[\s\S]+new[.]revoked_at is not null/i)
  assert.doesNotMatch(migration, /grant[\s\S]+delete[\s\S]+to service_role/i)
})
