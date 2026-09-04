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
  classifyCrossApprovalExistingUnpublishedOfferV1,
  classifyExactDraftOnlyPublicationSelfLineageV1,
} = await import("./ebay-one-click-controlled-publication-v1.ts")

const actor = "11111111-1111-4111-8111-111111111111"
const packageId = "22222222-2222-4222-8222-222222222222"
const opportunityId = "33333333-3333-4333-8333-333333333333"
const currentApprovalId = "44444444-4444-4444-8444-444444444444"
const priorApprovalId = "55555555-5555-4555-8555-555555555555"
const priorExecutionId = "66666666-6666-4666-8666-666666666666"
const candidateKey = "sha256:" + "a".repeat(64)
const fingerprint = "b".repeat(64)
const sku = "IMNOVA22222222222242228222222222222222"
const offerId = "255290419011"
const payloadHash = "c".repeat(64)

const marketplacePayload = {
  sku,
  listingPackage: { id: packageId, candidateKey },
  sourceEvidence: { opportunityId },
  inventoryItemPayload: {
    condition: "NEW",
    availability: { shipToLocationAvailability: { quantity: 1 } },
    product: { title: "Exact product", imageUrls: ["https://example.test/1.jpg"] },
  },
  offerPayload: {
    sku,
    marketplaceId: "EBAY_US",
    categoryId: "3087",
    availableQuantity: 1,
    pricingSummary: { price: { value: "27.64", currency: "USD" } },
  },
  safety: { target: "PRODUCTION", accountFingerprint: fingerprint },
}

function currentApproval(overrides = {}) {
  return {
    id: currentApprovalId,
    actor_user_id: actor,
    listing_package_id: packageId,
    opportunity_id: opportunityId,
    candidate_key: candidateKey,
    target: "PRODUCTION",
    account_fingerprint: fingerprint,
    status: "approved",
    consumed_at: null,
    revoked_at: null,
    expires_at: "2099-09-04T23:59:59.000Z",
    approved_payload: marketplacePayload,
    ...overrides,
  }
}

function priorApproval(overrides = {}) {
  return {
    id: priorApprovalId,
    actor_user_id: actor,
    listing_package_id: packageId,
    opportunity_id: opportunityId,
    candidate_key: candidateKey,
    target: "PRODUCTION",
    account_fingerprint: fingerprint,
    status: "consumed",
    consumed_at: "2026-09-04T01:31:40.651Z",
    revoked_at: null,
    payload_hash: payloadHash,
    approved_payload: marketplacePayload,
    ...overrides,
  }
}

function priorExecution(overrides = {}) {
  return {
    id: priorExecutionId,
    approval_id: priorApprovalId,
    actor_user_id: actor,
    listing_package_id: packageId,
    opportunity_id: opportunityId,
    request_hash: payloadHash,
    target: "PRODUCTION",
    account_fingerprint: fingerprint,
    sku,
    phase: "completed",
    offer_id: offerId,
    ...overrides,
  }
}

const expected = {
  actorUserId: actor,
  listingPackageId: packageId,
  opportunityId,
  candidateKey,
  target: "PRODUCTION",
  accountFingerprint: fingerprint,
  sku,
}

test("same package identity and exact marketplace payload classify as self-lineage", () => {
  const result = classifyCrossApprovalExistingUnpublishedOfferV1({
    currentApproval: currentApproval(),
    priorApproval: priorApproval(),
    priorExecution: priorExecution(),
    expected,
  })
  assert.equal(result.exact, true)
  assert.equal(result.reasonCode, "SELF_LINEAGE_EXISTING_UNPUBLISHED_OFFER")
  assert.equal(result.offerId, offerId)
  assert.equal(result.marketplacePayloadsEqual, true)
  assert.deepEqual(result.excludeApprovalIds, [currentApprovalId, priorApprovalId])
})

test("material payload drift remains a foreign collision", () => {
  const changed = currentApproval({
    approved_payload: {
      ...marketplacePayload,
      offerPayload: {
        ...marketplacePayload.offerPayload,
        pricingSummary: { price: { value: "28.64", currency: "USD" } },
      },
    },
  })
  const result = classifyCrossApprovalExistingUnpublishedOfferV1({
    currentApproval: changed,
    priorApproval: priorApproval(),
    priorExecution: priorExecution(),
    expected,
  })
  assert.equal(result.exact, false)
  assert.equal(result.reasonCode, "CROSS_APPROVAL_MARKETPLACE_PAYLOAD_CHANGED")
})

test("expired current authorization cannot unlock an existing offer", () => {
  const result = classifyCrossApprovalExistingUnpublishedOfferV1({
    currentApproval: currentApproval({
      expires_at: "2020-09-04T23:59:59.000Z",
    }),
    priorApproval: priorApproval(),
    priorExecution: priorExecution(),
    expected,
  })
  assert.equal(result.exact, false)
  assert.equal(result.reasonCode, "CURRENT_OWNER_AUTHORIZATION_NOT_ACTIVE")
})

test("reconciled current execution excludes both exact approval ledgers", () => {
  const executionId = "77777777-7777-4777-8777-777777777777"
  const current = currentApproval({ payload_hash: payloadHash })
  current.status = "consumed"
  current.consumed_at = "2026-09-04T20:45:00.000Z"
  const result = classifyExactDraftOnlyPublicationSelfLineageV1({
    approval: current,
    execution: {
      id: executionId,
      approval_id: currentApprovalId,
      actor_user_id: actor,
      listing_package_id: packageId,
      opportunity_id: opportunityId,
      request_hash: payloadHash,
      target: "PRODUCTION",
      account_fingerprint: fingerprint,
      sku,
      phase: "completed",
      offer_id: offerId,
      sanitized_result: {
        crossApprovalSameLineageResumeV1: {
          currentApprovalId,
          currentExecutionId: executionId,
          priorApprovalId,
          existingOfferId: offerId,
          officialReadbackVerified: true,
          marketplaceWrites: 0,
          inventoryItemCreated: false,
          offerCreated: false,
        },
      },
    },
    publication: null,
    expected,
  })
  assert.equal(result.exact, true)
  assert.equal(result.reasonCode, "SELF_LINEAGE_EXISTING_UNPUBLISHED_OFFER")
  assert.deepEqual(result.excludeApprovalIds, [currentApprovalId, priorApprovalId])
})

const route = readFileSync(new URL(
  "../../app/api/admin/ebay/draft-only/route.ts",
  import.meta.url,
), "utf8")
const workspace = readFileSync(new URL(
  "../../app/admin/ebay/listing-workspace/page.tsx",
  import.meta.url,
), "utf8")
const migration = readFileSync(new URL(
  "../../supabase/migrations/20260904204353_reconcile_cross_approval_existing_unpublished_offer_v1.sql",
  import.meta.url,
), "utf8")

test("runtime performs official GET comparison before durable zero-write reuse", () => {
  const authority = route.indexOf(
    "loadCrossApprovalExistingUnpublishedOfferAuthorityV1",
  )
  const inventoryGet = route.indexOf("verifyEbayDraftInventoryItem(", authority)
  const offerGet = route.indexOf("verifyEbayUnpublishedOffer(", authority)
  const reconcile = route.indexOf(
    'rpc("reconcile_ebay_cross_approval_unpublished_offer_v1"',
  )
  const createInventory = route.indexOf(
    "createOrReplaceEbayDraftInventoryItem",
    reconcile,
  )
  assert.ok(authority > 0)
  assert.ok(inventoryGet > authority)
  assert.ok(offerGet > authority)
  assert.ok(reconcile > offerGet)
  assert.ok(createInventory > reconcile)
  assert.match(route, /priorOwnerAuthorizationUsed: false/)
  assert.match(route, /inventoryItemCreated: false/)
  assert.match(route, /offerCreated: false/)
  assert.match(route, /publishOfferCalled: false/)
})

test("database reconciliation is service-only, atomic and preserves history", () => {
  assert.match(migration, /phase not in \('completed', 'terminal_failure'\)/)
  assert.match(migration, /v_prior_approval\.approved_payload->'inventoryItemPayload'[\s\S]*is distinct from[\s\S]*v_current_approval\.approved_payload->'inventoryItemPayload'/)
  assert.match(migration, /v_prior_approval\.approved_payload->'offerPayload'[\s\S]*is distinct from[\s\S]*v_current_approval\.approved_payload->'offerPayload'/)
  assert.match(migration, /'inventoryItemCreated', false/)
  assert.match(migration, /'offerCreated', false/)
  assert.match(migration, /'publishOfferCalled', false/)
  assert.match(migration, /revoke all on function[\s\S]*from public, anon, authenticated/)
  assert.match(migration, /grant execute on function[\s\S]*to service_role/)
  assert.doesNotMatch(migration, /delete from/i)
})

test("business package conflicts use 409 and successful reads clear stale UI errors", () => {
  assert.match(route, /code\.includes\("PACKAGE_CHANGED"\)[\s\S]*return 409/)
  assert.match(route, /status: status \?\? canonicalDraftOnlyErrorHttpStatus\(error\)/)
  assert.match(workspace, /successful canonical read owns the current header[\s\S]*setError\(""\)/)
})
