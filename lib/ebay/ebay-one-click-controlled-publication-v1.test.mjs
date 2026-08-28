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
  bindOneClickControlledPublicationIntentV1,
  EBAY_ONE_CLICK_CONTROLLED_PUBLICATION_VERSION,
  EBAY_ONE_CLICK_PUBLICATION_LABEL,
  EBAY_ONE_CLICK_PUBLICATION_SURFACE,
  validateOneClickControlledPublicationIntentV1,
} = await import("./ebay-one-click-controlled-publication-v1.ts")

const actor = "11111111-1111-4111-8111-111111111111"
const packageId = "22222222-2222-4222-8222-222222222222"
const opportunityId = "33333333-3333-4333-8333-333333333333"
const candidateKey = "luna:window-film:item3404"
const accountFingerprint = "a".repeat(64)

function listingPackage(overrides = {}) {
  return {
    id: packageId,
    candidate_key: candidateKey,
    package_data: {
      title: "Window Privacy Film One Way 23.6 in x 9.84 ft Tint for Home",
      categoryId: "175757",
      pricing: { targetPrice: 24.99 },
      imageUrls: ["https://assets.example.test/item3404-1.jpg"],
    },
    ...overrides,
  }
}

function opportunity(overrides = {}) {
  return { id: opportunityId, candidate_key: candidateKey, ...overrides }
}

function approvedPayload(overrides = {}) {
  return {
    version: 1,
    listingPackage: {
      id: packageId,
      candidateKey,
      sourceObservedAt: "2026-08-28T06:00:00.000Z",
      packageData: listingPackage().package_data,
    },
    sourceEvidence: { opportunityId, gtin: "740145348659" },
    sku: "ITEM3404",
    inventoryItemPayload: {
      condition: "NEW",
      availability: { shipToLocationAvailability: { quantity: 1 } },
      product: {
        title: "Window Privacy Film One Way 23.6 in x 9.84 ft Tint for Home",
        aspects: { Brand: ["Unbranded"], Type: ["Window Film"] },
        imageUrls: ["https://assets.example.test/item3404-1.jpg"],
      },
    },
    offerPayload: {
      sku: "ITEM3404",
      marketplaceId: "EBAY_US",
      format: "FIXED_PRICE",
      availableQuantity: 1,
      categoryId: "175757",
      merchantLocationKey: "US_33487",
      listingPolicies: {
        fulfillmentPolicyId: "331411848021",
        paymentPolicyId: "331411849021",
        returnPolicyId: "331411894021",
      },
      pricingSummary: { price: { value: "24.99", currency: "USD" } },
    },
    safety: {
      target: "PRODUCTION",
      accountFingerprint,
      unpublishedOnly: true,
      publishOfferPresent: false,
      permittedOperations: ["createOrReplaceInventoryItem", "createOffer"],
    },
    ...overrides,
  }
}

function bound() {
  return bindOneClickControlledPublicationIntentV1({
    approvedPayload: approvedPayload(),
    actorUserId: actor,
    listingPackage: listingPackage(),
  })
}

function validate(payload, overrides = {}) {
  return validateOneClickControlledPublicationIntentV1({
    approvedPayload: payload,
    actorUserId: actor,
    listingPackage: listingPackage(),
    opportunity: opportunity(),
    accountFingerprint,
    ...overrides,
  })
}

test("one explicit intent binds the exact candidate, package, account and commercial payload", () => {
  const payload = bound()
  const intent = payload.controlledPublicationIntent
  assert.equal(validate(payload).valid, true)
  assert.equal(intent.version, EBAY_ONE_CLICK_CONTROLLED_PUBLICATION_VERSION)
  assert.equal(intent.humanIntentLabel, EBAY_ONE_CLICK_PUBLICATION_LABEL)
  assert.equal(intent.authorizationSurface, EBAY_ONE_CLICK_PUBLICATION_SURFACE)
  assert.equal(intent.humanAuthorizationCount, 1)
  assert.equal(intent.secondHumanAuthorizationRequired, false)
  assert.equal(intent.unattendedPublicationAllowed, false)
  assert.equal(intent.listingPackageId, packageId)
  assert.equal(intent.opportunityId, opportunityId)
  assert.equal(intent.candidateKey, candidateKey)
  assert.equal(intent.accountFingerprint, accountFingerprint)
  assert.equal(intent.marketplaceId, "EBAY_US")
  assert.equal(intent.price.value, "24.99")
  assert.equal(intent.quantity, 1)
  assert.equal(intent.imageCount, 1)
  assert.equal(intent.machineContinuation.unpublishedOfficialReadbackRequired, true)
  assert.equal(intent.machineContinuation.activeOfficialReadbackRequired, true)
})

test("binding is deterministic and rebinding never nests or changes the authorization", () => {
  const first = bound()
  const second = bindOneClickControlledPublicationIntentV1({
    approvedPayload: first,
    actorUserId: actor,
    listingPackage: listingPackage(),
  })
  assert.deepEqual(second, first)
})

test("a durable package mutation invalidates the one-time intent precisely", () => {
  const changedPackage = listingPackage({
    package_data: { ...listingPackage().package_data, categoryId: "999999" },
  })
  const result = validate(bound(), { listingPackage: changedPackage })
  assert.equal(result.valid, false)
  assert.equal(result.blocker, "EBAY_ONE_CLICK_PUBLICATION_PACKAGE_CHANGED")
})

test("foreign candidate and account contexts fail closed", () => {
  const payload = bound()
  const foreignCandidate = validate(payload, {
    opportunity: opportunity({ candidate_key: "luna:foreign" }),
  })
  assert.equal(foreignCandidate.valid, false)
  assert.equal(foreignCandidate.blocker,
    "EBAY_ONE_CLICK_PUBLICATION_CANDIDATE_CHANGED")
  const foreignAccount = validate(payload, { accountFingerprint: "b".repeat(64) })
  assert.equal(foreignAccount.valid, false)
  assert.equal(foreignAccount.blocker,
    "EBAY_ONE_CLICK_PUBLICATION_ACCOUNT_CHANGED")
})

test("price, policy, image and category changes cannot reuse the authorization", () => {
  for (const [mutate, blocker] of [
    [(payload) => { payload.offerPayload.pricingSummary.price.value = "25.99" }, "EBAY_ONE_CLICK_PUBLICATION_INTENT_DIGEST_MISMATCH"],
    [(payload) => { payload.offerPayload.listingPolicies.returnPolicyId = "other" }, "EBAY_ONE_CLICK_PUBLICATION_INTENT_DIGEST_MISMATCH"],
    [(payload) => { payload.inventoryItemPayload.product.imageUrls.push("https://assets.example.test/foreign.jpg") }, "EBAY_ONE_CLICK_PUBLICATION_INTENT_DIGEST_MISMATCH"],
    [(payload) => { payload.offerPayload.categoryId = "999999" }, "EBAY_ONE_CLICK_PUBLICATION_INTENT_DIGEST_MISMATCH"],
    [(payload) => { payload.offerPayload.availableQuantity = 2 }, "EBAY_ONE_CLICK_PUBLICATION_INTENT_SCOPE_INVALID"],
  ]) {
    const payload = structuredClone(bound())
    mutate(payload)
    const result = validate(payload)
    assert.equal(result.valid, false)
    assert.equal(result.blocker, blocker)
  }
})

test("one-click UI and route preserve machine gates and legacy compatibility", () => {
  const route = readFileSync(new URL(
    "../../app/api/admin/ebay/draft-only/route.ts",
    import.meta.url,
  ), "utf8")
  const workspace = readFileSync(new URL(
    "../../app/admin/ebay/listing-workspace/page.tsx",
    import.meta.url,
  ), "utf8")
  assert.match(route, /bindOneClickControlledPublicationIntentV1/)
  assert.match(route, /verifyExactUnpublishedPublicationState/)
  assert.match(route, /expectedInventoryItemPayload/)
  assert.match(route, /expectedOfferPayload/)
  assert.match(route, /EBAY_FINAL_PUBLICATION_ACTIVE_READBACK_MISMATCH/)
  assert.match(route, /legacySecondAuthorizationValid/)
  assert.match(workspace, /data-one-click-controlled-publication/)
  assert.match(workspace, /"PUBLICAR EN EBAY"/)
  assert.match(workspace, /publishSmartStockingWithSingleAuthorization/)
  assert.match(workspace,
    /authorizationMode: "SELLER_OS_ONE_CLICK_CONTROLLED_PUBLICATION_V1"/)
  assert.match(workspace,
    /action: "execute"[\s\S]*action: "prepare_publish"[\s\S]*action: "publish"/)
  const machineContinuation = workspace.slice(
    workspace.indexOf("async function publishSmartStockingWithSingleAuthorization"),
    workspace.indexOf("async function approveDraft"),
  )
  assert.doesNotMatch(machineContinuation, /confirmFinalPreview|confirmPublish:/)
  assert.equal((workspace.match(/publishSmartStockingWithSingleAuthorization/g)
    ?? []).length, 2, "the flow is defined once and invoked only by its button")
})

test("one click refreshes canonical freshness before durable approval or writes", () => {
  const route = readFileSync(new URL(
    "../../app/api/admin/ebay/draft-only/route.ts",
    import.meta.url,
  ), "utf8")
  const workspace = readFileSync(new URL(
    "../../app/admin/ebay/listing-workspace/page.tsx",
    import.meta.url,
  ), "utf8")
  const approveStart = route.indexOf("async function approveDraft(")
  const approveEnd = route.indexOf("async function executeDraft(", approveStart)
  const approve = route.slice(approveStart, approveEnd)
  const sourceStart = route.indexOf(
    "async function refreshOneClickSmartStockingSource(",
  )
  const sourceEnd = route.indexOf("async function approveDraft(", sourceStart)
  const sourceRefresh = route.slice(sourceStart, sourceEnd)
  const clickStart = workspace.indexOf(
    "async function publishSmartStockingWithSingleAuthorization()",
  )
  const clickEnd = workspace.indexOf("async function approveDraft()", clickStart)
  const click = workspace.slice(clickStart, clickEnd)

  const exactIdentity = approve.indexOf('.from("ebay_listing_packages")')
  const lunaRefresh = approve.indexOf(
    "refreshOneClickSmartStockingSource(",
  )
  const ebayRefresh = approve.indexOf("preflightEbayDraftOnlyMobile(")
  const readiness = approve.indexOf("evaluateEbayDraftOnlyReadiness({")
  const durableApproval = approve.indexOf(
    '.rpc("approve_ebay_draft_only_package"',
  )
  assert.ok(exactIdentity >= 0 && lunaRefresh > exactIdentity)
  assert.ok(ebayRefresh > lunaRefresh)
  assert.ok(readiness > ebayRefresh)
  assert.ok(durableApproval > readiness)
  assert.match(sourceRefresh, /materializeWindowFilmListingIntakeV1/)
  assert.match(sourceRefresh, /ebay_save_listing_package_guarded/)
  assert.match(sourceRefresh, /resolveSmartStockingAuthorizedPublicationV1/)
  assert.doesNotMatch(sourceRefresh,
    /createOrReplaceEbayDraftInventoryItem|createEbayUnpublishedOffer|publishEbayOfferOnce/)
  assert.match(approve, /lunaSnapshot: "AUTO_REFRESHED"/)
  assert.match(approve, /packageSource: "AUTO_REVALIDATED"/)
  assert.match(approve, /ebayPreflightSnapshot: "AUTO_REFRESHED"/)
  assert.match(approve, /marketplaceWritesBeforeRefreshPass: 0/)
  assert.match(approve, /oneClickPrewriteError/)
  assert.equal((click.match(/action: "approve"/g) ?? []).length, 1,
    "HUMAN_CLICK_COUNT must stay one")
  assert.doesNotMatch(click, /action: "preflight"/)
  assert.doesNotMatch(click,
    /persistCurrentPackage\(\)[\s\S]*action: "approve"/)
  assert.match(click, /EBAY_ONE_CLICK_FRESHNESS_PREWRITE_INCOMPLETE/)
})

test("completed execution reuses its exact Offer and cannot create a duplicate", () => {
  const route = readFileSync(new URL(
    "../../app/api/admin/ebay/draft-only/route.ts",
    import.meta.url,
  ), "utf8")
  const workspace = readFileSync(new URL(
    "../../app/admin/ebay/listing-workspace/page.tsx",
    import.meta.url,
  ), "utf8")
  const publicationMigration = readFileSync(new URL(
    "../../supabase/migrations/20260720041000_create_ebay_authorized_listing_publication.sql",
    import.meta.url,
  ), "utf8")
  const clickStart = workspace.indexOf(
    "async function publishSmartStockingWithSingleAuthorization()",
  )
  const clickEnd = workspace.indexOf("async function approveDraft()", clickStart)
  const click = workspace.slice(clickStart, clickEnd)
  const prepareStart = route.indexOf("async function prepareFinalPublication(")
  const prepareEnd = route.indexOf(
    "async function compensateFinalPublicationAttachmentFailure(",
    prepareStart,
  )
  const prepare = route.slice(prepareStart, prepareEnd)

  assert.match(click,
    /if \(!nextExecution\?\.id \|\| nextExecution\.phase !== "completed"\)[\s\S]*action: "execute"/)
  assert.match(click,
    /action: "prepare_publish"[\s\S]*executionId: nextExecution\.id/)
  assert.match(prepare, /offerId: built\.offerId/)
  assert.doesNotMatch(prepare,
    /createOrReplaceEbayDraftInventoryItem|createEbayUnpublishedOffer/)
  assert.match(publicationMigration,
    /draft_execution_id uuid not null unique/)
  assert.match(publicationMigration,
    /publish_attempt_count between 0 and 1/)
})
