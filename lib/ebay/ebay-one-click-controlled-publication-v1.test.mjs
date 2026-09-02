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
  classifyAuthenticatedPublicationRecoveryV1,
  classifyExactDraftOnlyPublicationSelfLineageV1,
  EBAY_AUTHENTICATED_PUBLICATION_RECOVERY_VERSION,
  EBAY_ONE_CLICK_CONTROLLED_PUBLICATION_VERSION,
  EBAY_ONE_CLICK_PUBLICATION_LABEL,
  EBAY_ONE_CLICK_PUBLICATION_SURFACE,
  validateExactRearmedPublicationMaterialV1,
  validateOneClickControlledPublicationIntentV1,
} = await import("./ebay-one-click-controlled-publication-v1.ts")
const { canonicalListingReadyUi } = await import(
  "./ebay-listing-ready-ui-v1.ts"
)

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

const recoveryHash = "c".repeat(64)
const approvalId = "44444444-4444-4444-8444-444444444444"
const executionId = "55555555-5555-4555-8555-555555555555"
const publicationId = "66666666-6666-4666-8666-666666666666"
const offerId = "248277209011"

function recoveryPublication(overrides = {}) {
  return {
    id: publicationId,
    draft_execution_id: executionId,
    draft_approval_id: approvalId,
    listing_package_id: packageId,
    opportunity_id: opportunityId,
    target: "PRODUCTION",
    account_fingerprint: accountFingerprint,
    phase: "preview_ready",
    offer_id: offerId,
    sku: "ITEM3404",
    publish_attempt_count: 0,
    publication_idempotency_key: null,
    listing_id: null,
    ...overrides,
  }
}

function classifyRecovery(overrides = {}) {
  return classifyAuthenticatedPublicationRecoveryV1({
    readiness: { ready: true, blockers: [], payloadHash: recoveryHash },
    approval: {
      id: approvalId,
      listing_package_id: packageId,
      opportunity_id: opportunityId,
      candidate_key: candidateKey,
      target: "PRODUCTION",
      account_fingerprint: accountFingerprint,
      status: "consumed",
      consumed_at: "2026-08-28T12:00:00.000Z",
      revoked_at: null,
      payload_hash: recoveryHash,
    },
    execution: {
      id: executionId,
      approval_id: approvalId,
      listing_package_id: packageId,
      opportunity_id: opportunityId,
      target: "PRODUCTION",
      account_fingerprint: accountFingerprint,
      phase: "completed",
      request_hash: recoveryHash,
      offer_id: offerId,
      sku: "ITEM3404",
    },
    publication: null,
    controlledIntentValidation: validate(bound()),
    canonicalStockAuthorized: true,
    expected: {
      listingPackageId: packageId,
      opportunityId,
      candidateKey,
      target: "PRODUCTION",
      accountFingerprint,
    },
    ...overrides,
  })
}

function classifySelfLineage(overrides = {}) {
  const baseApproval = {
    id: approvalId,
    actor_user_id: actor,
    listing_package_id: packageId,
    opportunity_id: opportunityId,
    candidate_key: candidateKey,
    target: "PRODUCTION",
    account_fingerprint: accountFingerprint,
    status: "consumed",
    consumed_at: "2026-08-28T12:00:00.000Z",
    revoked_at: null,
    payload_hash: recoveryHash,
    approved_payload: approvedPayload(),
  }
  const baseExecution = {
    id: executionId,
    actor_user_id: actor,
    approval_id: approvalId,
    listing_package_id: packageId,
    opportunity_id: opportunityId,
    target: "PRODUCTION",
    account_fingerprint: accountFingerprint,
    phase: "completed",
    request_hash: recoveryHash,
    offer_id: offerId,
    sku: "ITEM3404",
  }
  const basePublication = recoveryPublication({
    preview: {
      draftExecutionId: executionId,
      draftApprovalId: approvalId,
      listingPackageId: packageId,
      opportunityId,
      candidateKey,
      approvedPayloadHash: recoveryHash,
      offerId,
      sku: "ITEM3404",
      inventoryItemPayload: approvedPayload().inventoryItemPayload,
      offerPayload: approvedPayload().offerPayload,
    },
    sanitized_result: {
      compensatedRecoveryCount: 1,
      compensatedRecoveryAuthorizedAt: "2026-08-28T15:00:00.000Z",
    },
  })
  return classifyExactDraftOnlyPublicationSelfLineageV1({
    approval: { ...baseApproval, ...(overrides.approval ?? {}) },
    execution: { ...baseExecution, ...(overrides.execution ?? {}) },
    publication: overrides.publication === null
      ? null
      : { ...basePublication, ...(overrides.publication ?? {}) },
    expected: {
      actorUserId: actor,
      listingPackageId: packageId,
      opportunityId,
      candidateKey,
      target: "PRODUCTION",
      accountFingerprint,
      sku: "ITEM3404",
      ...(overrides.expected ?? {}),
    },
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
  assert.match(machineContinuation,
    /rearmedSelfLineageAuthorization \? \{[\s\S]*confirmFinalPreview: true/)
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
  assert.match(approve,
    /lunaSnapshot:[\s\S]*"DURABLE_REVALIDATED"[\s\S]*"AUTO_REFRESHED"/)
  assert.match(approve,
    /packageSource:[\s\S]*"DURABLE_REUSED"[\s\S]*"AUTO_REVALIDATED"/)
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

test("authenticated hydration reuses canonical Luna/package/preflight refresh authorities", () => {
  const route = readFileSync(new URL(
    "../../app/api/admin/ebay/draft-only/route.ts",
    import.meta.url,
  ), "utf8")
  const workspace = readFileSync(new URL(
    "../../app/admin/ebay/listing-workspace/page.tsx",
    import.meta.url,
  ), "utf8")
  const hydration = workspace.slice(
    workspace.indexOf("const state = await request(undefined, opportunityId)"),
    workspace.indexOf("setImageRevision(null)"),
  )
  const getStart = route.indexOf("export async function GET(req: Request)")
  const getEnd = route.indexOf("export async function POST(req: Request)")
  const get = route.slice(getStart, getEnd)

  assert.match(hydration,
    /action: "prepare_smart_stocking_listing_intake"/)
  assert.match(hydration,
    /COMMAND_CENTER_SMART_STOCKING_REFRESH_IDENTITY_MISMATCH/)
  assert.ok(hydration.indexOf("prepare_smart_stocking_listing_intake") <
    hydration.indexOf('action: "prepare_package"'))
  assert.match(get, /preflightEbayDraftOnlyMobile\(selection\)/)
  assert.match(get, /fresh\.snapshotStatus === "READY"/)
  assert.match(get, /ebayPreflightSnapshot: fresh\.snapshot/)
  assert.doesNotMatch(get,
    /createOrReplaceEbayDraftInventoryItem|createEbayUnpublishedOffer|publishEbayOfferOnce|action: "approve"/)
})

test("NO_APPROVAL_MUTATION + OPERATION_COMPLETED_OR_STOPPED -> STALE_AUTOMATION_STEP_NOT_VISIBLE", () => {
  const workspace = readFileSync(new URL(
    "../../app/admin/ebay/listing-workspace/page.tsx",
    import.meta.url,
  ), "utf8")
  const clearCalls = workspace.match(
    /setPublicationAutomationStep\(""\)/g,
  ) ?? []
  assert.equal(clearCalls.length, 4,
    "every publication/recovery automation finally clears presentation state")
  const oneClick = workspace.slice(
    workspace.indexOf(
      "async function publishSmartStockingWithSingleAuthorization()",
    ),
    workspace.indexOf("async function approveDraft()"),
  )
  assert.match(oneClick,
    /finally\s*{[\s\S]*?setPublicationAutomationStep\(""\)[\s\S]*?setPublicationAutomationBusy\(false\)/)
  assert.equal((oneClick.match(/action: "approve"/g) ?? []).length, 1)
  assert.doesNotMatch(oneClick,
    /finally\s*{[\s\S]*?action: "approve"/)
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

test("interrupted exact authorization is resumable without another human approval", () => {
  const recovery = classifyRecovery()
  assert.equal(recovery.version,
    EBAY_AUTHENTICATED_PUBLICATION_RECOVERY_VERSION)
  assert.equal(recovery.state, "RESUMABLE_AUTHORIZED_PUBLICATION")
  assert.equal(recovery.autoResume, true)
  assert.equal(recovery.approvalId, approvalId)
  assert.equal(recovery.executionId, executionId)
  assert.equal(recovery.offerId, offerId)
  assert.equal(recovery.authorizedPayloadHash, recoveryHash)
  assert.equal(recovery.requestHash, recoveryHash)
  assert.equal(recovery.canonicalStockAuthorized, true)
  assert.equal(recovery.reusesExistingHumanApproval, true)
  assert.equal(recovery.newHumanApprovalAllowed, false)

  const refreshesFinalPreflight = classifyRecovery({
    readiness: {
      ready: false,
      blockers: ["EBAY_PREFLIGHT_SNAPSHOT_STALE"],
      payloadHash: recoveryHash,
    },
  })
  assert.equal(refreshesFinalPreflight.state,
    "RESUMABLE_AUTHORIZED_PUBLICATION")
  assert.equal(refreshesFinalPreflight.autoResume, true)
})

test("changed payload or stock authority fails closed before recovery", () => {
  const changed = classifyRecovery({
    controlledIntentValidation: {
      valid: false,
      blocker: "EBAY_ONE_CLICK_PUBLICATION_PACKAGE_CHANGED",
      intent: {},
    },
  })
  assert.equal(changed.state, "RECOVERY_BLOCKED")
  assert.equal(changed.autoResume, false)
  assert.equal(changed.blocker, "EBAY_ONE_CLICK_PUBLICATION_PACKAGE_CHANGED")

  const mismatchedRequest = classifyRecovery({
    execution: {
      id: executionId,
      approval_id: approvalId,
      listing_package_id: packageId,
      opportunity_id: opportunityId,
      target: "PRODUCTION",
      account_fingerprint: accountFingerprint,
      phase: "completed",
      request_hash: "d".repeat(64),
      offer_id: offerId,
      sku: "ITEM3404",
    },
  })
  assert.equal(mismatchedRequest.state, "RECOVERY_BLOCKED")
  assert.equal(mismatchedRequest.blocker, "APPROVED_PAYLOAD_CHANGED")

  const stockChanged = classifyRecovery({ canonicalStockAuthorized: false })
  assert.equal(stockChanged.state, "RECOVERY_BLOCKED")
  assert.equal(stockChanged.blocker,
    "EBAY_AUTHENTICATED_RECOVERY_CANONICAL_STOCK_REQUIRED")

  const realCanonicalBlocker = classifyRecovery({
    readiness: {
      ready: false,
      blockers: ["PACKAGE_SOURCE_STALE"],
      payloadHash: recoveryHash,
    },
  })
  assert.equal(realCanonicalBlocker.state, "RECOVERY_BLOCKED")
  assert.equal(realCanonicalBlocker.blocker, "PACKAGE_SOURCE_STALE")
})

test("ACTIVE and already-claimed publications can never republish", () => {
  const active = classifyRecovery({
    publication: recoveryPublication({
      phase: "monitor_registered",
      publish_attempt_count: 1,
      publication_idempotency_key: `publish:${publicationId}`,
      listing_id: "248277209011",
      verified_active_at: "2026-08-28T12:05:00.000Z",
      monitor_registered_at: "2026-08-28T12:06:00.000Z",
    }),
  })
  assert.equal(active.state, "ACTIVE_VERIFIED")
  assert.equal(active.autoResume, false)

  const claimed = classifyRecovery({
    publication: recoveryPublication({
      phase: "publish_in_flight",
      publish_attempt_count: 1,
      publication_idempotency_key: `publish:${publicationId}`,
    }),
  })
  assert.equal(claimed.state, "PUBLISH_ALREADY_CLAIMED")
  assert.equal(claimed.autoResume, false)
  assert.equal(claimed.blocker,
    "EBAY_FINAL_PUBLICATION_RECONCILIATION_REQUIRED")
})

test("compensated rearm waits for the normal human publish action", () => {
  const rearmed = classifyRecovery({
    publication: recoveryPublication({
      sanitized_result: {
        compensatedRecoveryCount: 1,
        compensatedRecoveryAuthorizedAt: "2026-08-28T15:00:00.000Z",
      },
    }),
  })
  assert.equal(rearmed.state, "REARMED_AWAITING_HUMAN_PUBLICATION")
  assert.equal(rearmed.autoResume, false)
  assert.equal(rearmed.reusesExistingHumanApproval, true)
  assert.equal(rearmed.newHumanApprovalAllowed, false)
  assert.equal(rearmed.offerId, offerId)
})

test("SAFE_COMPENSATED_LINEAGE + READINESS_BLOCKERS_PRESENT -> REARM_SUCCEEDS_BUT_PUBLISH_REMAINS_BLOCKED", () => {
  const blockers = [
    "LUNA_SNAPSHOT_STALE",
    "PACKAGE_SOURCE_STALE",
    "REQUIRED_ASPECT_MISSING:Brand",
    "EBAY_PREFLIGHT_SNAPSHOT_STALE",
  ]
  const rearmed = classifyRecovery({
    controlledIntentValidation: null,
    readiness: {
      ready: false,
      blockers,
      payloadHash: recoveryHash,
    },
    canonicalStockAuthorized: false,
    publication: recoveryPublication({
      sanitized_result: {
        compensatedRecoveryCount: 1,
        compensatedRecoveryAuthorizedAt: "2026-08-28T15:00:00.000Z",
      },
    }),
  })
  assert.equal(rearmed.state, "REARMED_AWAITING_HUMAN_PUBLICATION")
  assert.equal(rearmed.autoResume, false)
  assert.equal(rearmed.reusesExistingHumanApproval, true)
  assert.equal(rearmed.newHumanApprovalAllowed, false)
  const publishReadiness = canonicalListingReadyUi({
    ready: false,
    blockers,
  })
  assert.equal(publishReadiness.listingReady, false)
  assert.strictEqual(publishReadiness.uiBlockers, blockers)
})

test("missing or differently bound Offer fails closed", () => {
  const missing = classifyRecovery({
    execution: {
      id: executionId,
      approval_id: approvalId,
      listing_package_id: packageId,
      opportunity_id: opportunityId,
      target: "PRODUCTION",
      account_fingerprint: accountFingerprint,
      phase: "completed",
      request_hash: recoveryHash,
      offer_id: null,
      sku: "ITEM3404",
    },
  })
  assert.equal(missing.state, "RECOVERY_BLOCKED")
  assert.equal(missing.blocker,
    "EBAY_AUTHENTICATED_RECOVERY_COMPLETED_OFFER_REQUIRED")

  const different = classifyRecovery({
    publication: recoveryPublication({ offer_id: "DIFFERENT_OFFER" }),
  })
  assert.equal(different.state, "RECOVERY_BLOCKED")
  assert.equal(different.blocker,
    "EBAY_AUTHENTICATED_RECOVERY_PUBLICATION_CHANGED")
})

test("authenticated page hydration resumes only prepare and one-shot publish", () => {
  const route = readFileSync(new URL(
    "../../app/api/admin/ebay/draft-only/route.ts",
    import.meta.url,
  ), "utf8")
  const workspace = readFileSync(new URL(
    "../../app/admin/ebay/listing-workspace/page.tsx",
    import.meta.url,
  ), "utf8")
  const recoveryStart = workspace.indexOf(
    "const recovery = draftState.authenticatedPublicationRecovery",
  )
  const recoveryEnd = workspace.indexOf(
    "async function approveDraft()",
    recoveryStart,
  )
  const recovery = workspace.slice(recoveryStart, recoveryEnd)
  const prepareIndex = recovery.indexOf('action: "prepare_publish"')
  const publishIndex = recovery.indexOf('action: "publish"')
  assert.ok(recoveryStart > 0 && recoveryEnd > recoveryStart)
  assert.ok(prepareIndex > 0 && publishIndex > prepareIndex)
  assert.equal((recovery.match(/action: "publish"/g) ?? []).length, 1)
  assert.doesNotMatch(recovery,
    /action: "approve"|action: "execute"|createEbayUnpublishedOffer|createOrReplaceEbayDraftInventoryItem/)
  assert.match(recovery, /reusesExistingHumanApproval !== true/)
  assert.match(recovery, /newHumanApprovalAllowed !== false/)
  assert.match(recovery, /published\.listing\?\.status !== "ACTIVE"/)
  assert.match(recovery, /published\.monitoring\?\.registered !== true/)

  const getStart = route.indexOf("export async function GET(req: Request)")
  const postStart = route.indexOf("export async function POST(req: Request)")
  const getRoute = route.slice(getStart, postStart)
  assert.match(getRoute, /classifyAuthenticatedPublicationRecoveryV1/)
  assert.match(getRoute, /loadExactDraftOnlyPublicationSelfLineage/)
  assert.match(getRoute, /lifecycle\.classification/)
  const publishStart = route.indexOf("async function publishFinalPublication(")
  const publishEnd = route.indexOf("async function rearmFinalPublication(")
  const publishRoute = route.slice(publishStart, publishEnd)
  const officialReadbackIndex = publishRoute.indexOf(
    "verifyExactUnpublishedPublicationState",
  )
  const finalPreflightIndex = publishRoute.indexOf(
    "revalidateFinalPublicationDependencies",
  )
  const duplicateGuardIndex = publishRoute.indexOf(
    "revalidateFinalPublicationDuplicateGuard",
  )
  const claimIndex = publishRoute.indexOf(
    'rpc("claim_ebay_authorized_listing_publication"',
  )
  assert.ok(officialReadbackIndex > 0)
  assert.ok(finalPreflightIndex > officialReadbackIndex)
  assert.ok(duplicateGuardIndex > finalPreflightIndex)
  assert.ok(claimIndex > duplicateGuardIndex)
  assert.ok(publishRoute.indexOf("claimedPublication.claim_token") <
    publishRoute.indexOf("publishEbayOfferOnce"))
})

test("expired admin session reaches no recovery write", () => {
  const route = readFileSync(new URL(
    "../../app/api/admin/ebay/draft-only/route.ts",
    import.meta.url,
  ), "utf8")
  const workspace = readFileSync(new URL(
    "../../app/admin/ebay/listing-workspace/page.tsx",
    import.meta.url,
  ), "utf8")
  const requestStart = workspace.indexOf("const draftRequest = useCallback")
  const requestEnd = workspace.indexOf("useEffect(() => {", requestStart)
  const request = workspace.slice(requestStart, requestEnd)
  assert.ok(request.indexOf("supabase.auth.getSession()") <
    request.indexOf("fetch(endpoint"))
  assert.match(request, /!data\.session/)

  const postStart = route.indexOf("export async function POST(req: Request)")
  const actionIndex = route.indexOf("const action = text(body.action)", postStart)
  const authIndex = route.indexOf("const auth = await authenticate(req)", postStart)
  assert.ok(authIndex > 0 && authIndex < actionIndex)
})

test("REARMED_EXACT_EXECUTION_SELF_SKU -> NO_COLLISION", () => {
  const lineage = classifySelfLineage({ publication: null })
  assert.equal(lineage.exact, true)
  assert.equal(lineage.reasonCode, "EXACT_EXECUTION_SELF_LINEAGE")
  assert.equal(lineage.excludeApprovalId, approvalId)
})

test("REARMED_EXACT_OFFER_SELF_LINEAGE -> NO_COLLISION", () => {
  const lineage = classifySelfLineage()
  assert.equal(lineage.exact, true)
  assert.equal(lineage.reasonCode, "REARMED_EXACT_OFFER_SELF_LINEAGE")
  assert.equal(lineage.rearmedAwaitingHumanPublication, true)
  assert.equal(lineage.excludeApprovalId, approvalId)
})

test("SAME_SKU_DIFFERENT_EXECUTION -> SKU_COLLISION", () => {
  const lineage = classifySelfLineage({
    publication: { draft_execution_id: "different-execution" },
  })
  assert.equal(lineage.exact, false)
  assert.equal(lineage.reasonCode, "SELF_LINEAGE_PUBLICATION_MISMATCH")
  assert.equal(lineage.excludeApprovalId, null)
})

test("SAME_SKU_DIFFERENT_CANDIDATE -> SKU_COLLISION", () => {
  const lineage = classifySelfLineage({
    expected: { candidateKey: "luna:other-candidate" },
  })
  assert.equal(lineage.exact, false)
  assert.equal(lineage.reasonCode, "SELF_LINEAGE_IDENTITY_MISMATCH")
  assert.equal(lineage.excludeApprovalId, null)
})

test("rearmed material equality covers exact Offer, Inventory Item, account and package", () => {
  const current = approvedPayload()
  assert.equal(validateExactRearmedPublicationMaterialV1({
    approvedPayload: approvedPayload(),
    currentPayload: current,
  }).exact, true)
  assert.equal(validateExactRearmedPublicationMaterialV1({
    approvedPayload: approvedPayload(),
    currentPayload: {
      ...current,
      offerPayload: {
        ...current.offerPayload,
        pricingSummary: { price: { value: "26.99", currency: "USD" } },
      },
    },
  }).exact, false)
})

test("GET_AND_POST_SKU_COLLISION_SEMANTICS_MATCH", () => {
  const route = readFileSync(new URL(
    "../../app/api/admin/ebay/draft-only/route.ts",
    import.meta.url,
  ), "utf8")
  const getStart = route.indexOf("export async function GET(req: Request)")
  const postStart = route.indexOf("export async function POST(req: Request)")
  const approveStart = route.indexOf("async function approveDraft(")
  const executeStart = route.indexOf("async function executeDraft(")
  const get = route.slice(getStart, postStart)
  const approve = route.slice(approveStart, executeStart)
  assert.match(get, /loadExactDraftOnlyPublicationSelfLineage\(/)
  assert.match(
    get,
    /resolveCorrectedPackageRetryCollisionSelfLineageV1/,
  )
  assert.match(get, /collisionSelfLineage/)
  assert.match(approve, /loadExactDraftOnlyPublicationSelfLineage\(/)
  assert.match(approve, /exactSelfLineage\.classification/)
  assert.doesNotMatch(get, /\.neq\("approval_id",\s*latestApproval/)
  assert.doesNotMatch(approve, /\.neq\("approval_id",/)
})

test("ACTIVE_DUPLICATE -> BLOCK independently of self-lineage exclusion", () => {
  const route = readFileSync(new URL(
    "../../app/api/admin/ebay/draft-only/route.ts",
    import.meta.url,
  ), "utf8")
  const readiness = readFileSync(new URL(
    "./ebay-draft-only-readiness.ts",
    import.meta.url,
  ), "utf8")
  assert.match(route,
    /collisionContext\.activeSkuCollision[\s\S]*EBAY_FINAL_PUBLICATION_DUPLICATE_DETECTED/)
  assert.match(readiness,
    /input\.activeSkuCollision \|\| input\.ledgerSkuCollision/)
})

test("EXACT_CURRENT_APPROVAL_EXISTS -> NO_NEW_APPROVAL", () => {
  const route = readFileSync(new URL(
    "../../app/api/admin/ebay/draft-only/route.ts",
    import.meta.url,
  ), "utf8")
  const approveStart = route.indexOf("async function approveDraft(")
  const executeStart = route.indexOf("async function executeDraft(")
  const approve = route.slice(approveStart, executeStart)
  const selfLineageReturn = approve.indexOf(
    "REARMED_EXACT_SELF_LINEAGE_CURRENT_HUMAN_CLICK",
  )
  const approvalRpc = approve.indexOf('.rpc("approve_ebay_draft_only_package"')
  assert.ok(selfLineageReturn > 0 && approvalRpc > selfLineageReturn)
  assert.match(approve, /newHumanApprovalCreated: false/)
})

test("APPROVE_FAILURE -> UI_PHASE_RESETS_AND_REASON_VISIBLE", () => {
  const workspace = readFileSync(new URL(
    "../../app/admin/ebay/listing-workspace/page.tsx",
    import.meta.url,
  ), "utf8")
  const clickStart = workspace.indexOf(
    "async function publishSmartStockingWithSingleAuthorization()",
  )
  const clickEnd = workspace.indexOf("\n  useEffect(() => {", clickStart)
  const click = workspace.slice(clickStart, clickEnd)
  const catchStart = click.indexOf("} catch (requestError) {")
  const failure = click.slice(catchStart)
  assert.match(failure, /setPublicationAutomationPhase\("idle"\)/)
  assert.match(failure, /setPublicationAutomationStep\(""\)/)
  assert.match(failure, /setPublicationAutomationStartedAt\(null\)/)
  assert.match(failure, /prewriteBlockers/)
  assert.match(failure, /setError\(/)
})

test("ONE_HUMAN_CLICK -> APPROVE_SUCCESS_CONTINUES_TO_PUBLISH_PATH", () => {
  const workspace = readFileSync(new URL(
    "../../app/admin/ebay/listing-workspace/page.tsx",
    import.meta.url,
  ), "utf8")
  const clickStart = workspace.indexOf(
    "async function publishSmartStockingWithSingleAuthorization()",
  )
  const clickEnd = workspace.indexOf("\n  useEffect(() => {", clickStart)
  const click = workspace.slice(clickStart, clickEnd)
  assert.equal((click.match(/action: "approve"/g) ?? []).length, 1)
  assert.equal((click.match(/action: "publish"/g) ?? []).length, 1)
  assert.match(click, /nextExecution = authorized\.execution \?\? nextExecution/)
  assert.match(click, /nextPublication = authorized\.publication \?\? nextPublication/)
  assert.match(click, /rearmedSelfLineageAuthorization/)
  assert.match(click, /confirmPublish: "PUBLICAR LISTING EN EBAY"/)
  assert.match(click, /confirmFinalPreview: true/)
  assert.match(click, /confirmProductionAccount: true/)
})
