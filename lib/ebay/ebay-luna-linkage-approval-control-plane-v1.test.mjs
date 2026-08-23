import assert from "node:assert/strict"
import { registerHooks } from "node:module"
import test from "node:test"

registerHooks({
  resolve(specifier, context, nextResolve) {
    const value = String(specifier ?? "")
    if (value.startsWith(".") && !/\.(?:ts|tsx|mjs|js|json)$/.test(value)) {
      try { return nextResolve(`${value}.ts`, context) } catch {
        return nextResolve(specifier, context)
      }
    }
    return nextResolve(specifier, context)
  },
})

const {
  SELLER_OS_LUNA_LINKAGE_APPROVAL_CSRF_TTL_MS,
  SELLER_OS_LUNA_LINKAGE_IDENTITY_EVIDENCE_MAXIMUM_AGE_SECONDS,
  assertSellerOsLunaLinkageApprovalAdminV1,
  buildSellerOsLunaLinkageReviewEntryV2,
  buildSellerOsLunaLinkageReviewSetV2,
  createSellerOsLunaLinkageApprovalCsrfBoundaryV1,
  executeSellerOsLunaLinkageApprovalDecisionV1,
  parseSellerOsLunaLinkageApprovalRequestV1,
} = await import("./ebay-luna-linkage-approval-control-plane-v1.ts")

const ACTOR = "11111111-1111-4111-8111-111111111111"
const COHORT = `current-live:EBAY_US:${"a".repeat(24)}`
const REQUEST_URL =
  "http://localhost:3000/api/admin/ebay/luna-supplier-linkage-review"
const SESSION = `admin-session-${"a".repeat(64)}`
const OBSERVED_AT = "2026-08-22T15:30:00.000Z"
const CURRENT_IDENTITY_REFERENCE =
  `luna-identity-v1:sha256:${"c".repeat(64)}`
const CURRENT_IDENTITY_PROVENANCE = Object.freeze({
  contractVersion: "SELLER_OS_LUNA_IDENTITY_VERIFICATION_V1",
  sourceStatus: "AVAILABLE",
  acquisitionMethod: "CANONICAL_SERVER_READ_IDENTITY_ONLY",
})

function component(overrides = {}) {
  return {
    lunaProductId: "9220805755104",
    lunaVariantId: "48809607659744",
    lunaSku: "ITEM5810",
    productTitle: "Z6 Portable Language Translator Device",
    variantTitle: "Black",
    supplierQuantityRequired: 1,
    quantityBasis: "STRUCTURED_EVIDENCE",
    variantPresence: "PRESENT",
    exactProductIdentity: true,
    exactVariantIdentity: true,
    exactSupplierSku: true,
    structuredVariantAttributesComplete: true,
    identityConflict: false,
    ...overrides,
  }
}

function entry(overrides = {}) {
  return buildSellerOsLunaLinkageReviewEntryV2({
    currentCohortId: COHORT,
    accountKey: "canonical-ebay-account",
    ebayItemId: "366582586826",
    ebaySku: "IMN-LST-000011",
    listingTitle: "Z6 AI Translator 138 Languages Black",
    classification: "EXACT_UNIQUE_MATCH",
    linkageMode: "SINGLE_COMPONENT",
    components: [component()],
    matchSignals: ["EXACT_SUPPLIER_SKU", "EXACT_VARIANT_ATTRIBUTES"],
    conflictSignals: [],
    evidenceReferences: [CURRENT_IDENTITY_REFERENCE],
    evidenceObservedAt: OBSERVED_AT,
    reviewObservedAt: OBSERVED_AT,
    identityEvidenceProvenance: CURRENT_IDENTITY_PROVENANCE,
    decisionVersion: 1,
    ...overrides,
  })
}

function reviewSet(entries = [entry()]) {
  return buildSellerOsLunaLinkageReviewSetV2({
    currentCohortId: COHORT,
    accountKey: "canonical-ebay-account",
    currentLiveCount: entries.length,
    entries,
  })
}

function request(review = reviewSet(), overrides = {}) {
  const candidate = review.entries[0]
  return {
    reviewSetId: review.reviewSetId,
    currentCohortId: review.currentCohortId,
    ebayItemId: candidate.ebayItemId,
    candidateEvidenceDigest: candidate.evidenceDigest,
    decision: "APPROVE_EXACT_LINKAGE",
    decisionVersion: candidate.decisionVersion,
    ...overrides,
  }
}

function csrfHarness(review = reviewSet()) {
  let at = 1_800_000_000_000
  let counter = 1
  const boundary = createSellerOsLunaLinkageApprovalCsrfBoundaryV1({
    now: () => at,
    random: (bytes) => Buffer.alloc(bytes, counter++),
  })
  const context = {
    actorUserId: ACTOR,
    adminSessionToken: SESSION,
    requestUrl: REQUEST_URL,
    origin: null,
    secFetchSite: "same-origin",
    currentCohortId: review.currentCohortId,
    reviewSetDigest: review.reviewSetDigest,
  }
  return {
    boundary,
    issue(overrides = {}) { return boundary.issue({ ...context, ...overrides }) },
    consume(token, overrides = {}) {
      return boundary.consume({
        ...context,
        origin: "http://127.0.0.1:3000",
        contentType: "application/json",
        csrfHeader: token,
        csrfCookie: token,
        ...overrides,
      })
    },
    advance(milliseconds) { at += milliseconds },
  }
}

function memoryStore() {
  const rows = new Map()
  return async (decision) => {
    const key = [decision.accountKey, decision.marketplaceId,
      decision.ebayItemId, decision.decisionVersion].join(":")
    const existing = rows.get(key)
    if (!existing) {
      rows.set(key, decision)
      return { outcome: "CREATED",
        decisionReference: decision.decisionReference }
    }
    if (existing.decisionPayloadDigest === decision.decisionPayloadDigest &&
        existing.decision === decision.decision &&
        existing.evidenceDigest === decision.evidenceDigest) {
      return { outcome: "IDEMPOTENT_SUCCESS",
        decisionReference: decision.decisionReference }
    }
    return { outcome: "CONFLICT_REQUIRES_NEW_DECISION_VERSION",
      decisionReference: decision.decisionReference }
  }
}

async function execute({ review = reviewSet(), body, store = memoryStore(),
  auth = { ok: true, userId: ACTOR, authenticationMode: "admin_user" },
  csrfOverrides = {}, now = () => OBSERVED_AT } = {}) {
  const csrf = csrfHarness(review)
  const issued = csrf.issue()
  const receipt = csrf.consume(issued.csrfToken, csrfOverrides)
  return executeSellerOsLunaLinkageApprovalDecisionV1({
    adminValidation: auth,
    csrfReceipt: receipt,
    request: body ?? request(review),
    currentReviewSet: review,
    durableStore: store,
    now,
  })
}

test("exact current product and exact variant are approval-eligible", () => {
  const candidate = entry()
  assert.equal(candidate.classification, "EXACT_UNIQUE_MATCH")
  assert.equal(candidate.approvalEligibility.eligible, true)
  assert.deepEqual(candidate.allowedOperatorDecisions, [
    "APPROVE_EXACT_LINKAGE", "REJECT_CANDIDATE", "KEEP_UNPROVEN",
  ])
  assert.match(candidate.linkageId,
    /^luna-linkage-v1:sha256:[0-9a-f]{64}$/)
  assert.equal(candidate.evidenceFreshness, "CURRENT")
  assert.equal(candidate.reviewObservedAt, OBSERVED_AT)
  assert.equal(candidate.evidenceMaximumAgeSeconds,
    SELLER_OS_LUNA_LINKAGE_IDENTITY_EVIDENCE_MAXIMUM_AGE_SECONDS)
  assert.deepEqual(candidate.identityEvidenceProvenance,
    CURRENT_IDENTITY_PROVENANCE)
  assert.equal(candidate.stockCertification.status, "NOT_EVALUATED")
})

test("stale, future, unavailable, and unreferenced identity evidence fail closed", () => {
  const stale = entry({
    reviewObservedAt: "2026-08-22T21:30:01.000Z",
  })
  assert.equal(stale.evidenceFreshness, "STALE")
  assert.equal(stale.approvalEligibility.eligible, false)
  assert.ok(stale.approvalEligibility.reasonCodes.includes(
    "CURRENT_LUNA_IDENTITY_EVIDENCE_REQUIRED"))

  const unavailable = entry({
    identityEvidenceProvenance: {
      contractVersion: "SELLER_OS_LUNA_IDENTITY_VERIFICATION_V1",
      sourceStatus: "UNAVAILABLE",
      acquisitionMethod: "NONE",
    },
  })
  assert.equal(unavailable.approvalEligibility.eligible, false)
  assert.ok(unavailable.approvalEligibility.reasonCodes.includes(
    "CANONICAL_LUNA_IDENTITY_PROVENANCE_REQUIRED"))

  const unreferenced = entry({ evidenceReferences: [] })
  assert.equal(unreferenced.approvalEligibility.eligible, false)
  assert.ok(unreferenced.approvalEligibility.reasonCodes.includes(
    "CURRENT_LUNA_IDENTITY_REFERENCE_REQUIRED"))

  assert.throws(() => entry({
    evidenceObservedAt: "2026-08-22T15:35:01.000Z",
  }), /LUNA_LINKAGE_REVIEW_EVIDENCE_FUTURE_REJECTED/)
  assert.throws(() => entry({
    identityEvidenceProvenance: {
      contractVersion: "WRONG_CONTRACT",
      sourceStatus: "AVAILABLE",
      acquisitionMethod: "CANONICAL_SERVER_READ_IDENTITY_ONLY",
    },
  }), /LUNA_LINKAGE_REVIEW_IDENTITY_PROVENANCE_INVALID/)
  assert.throws(() => entry({
    identityEvidenceProvenance: {
      contractVersion: "SELLER_OS_LUNA_IDENTITY_VERIFICATION_V1",
      sourceStatus: "AVAILABLE",
      acquisitionMethod: "NONE",
    },
  }), /LUNA_LINKAGE_REVIEW_IDENTITY_PROVENANCE_INVALID/)
})

test("conflict signals block exact-looking approval", () => {
  const candidate = entry({ conflictSignals: ["CURRENT_IDENTITY_CONFLICT"] })
  assert.equal(candidate.classification, "EXACT_UNIQUE_MATCH")
  assert.equal(candidate.approvalEligibility.eligible, false)
  assert.equal(candidate.allowedOperatorDecisions.includes(
    "APPROVE_EXACT_LINKAGE"), false)
  assert.ok(candidate.approvalEligibility.reasonCodes.includes(
    "CONFLICT_SIGNALS_PRESENT"))
})

test("internal Market Radar UUIDs cannot cross the external Luna identity boundary", () => {
  for (const components of [
    [component({
      lunaProductId: "178f272d-2eeb-4a9a-ab55-6595ce30f3f4",
    })],
    [component({
      lunaVariantId: "178f272d-2eeb-4a9a-ab55-6595ce30f3f4",
    })],
  ]) assert.throws(() => entry({ components }),
    /LUNA_LINKAGE_REVIEW_COMPONENT_INVALID/)
})

test("canonical Luna SKUs with safe spaces remain representable", () => {
  const value = entry({ components: [component({
    lunaSku: "Jhoel-Food Scale-with Nutritional-Calculator-B0CS36YWSB",
  })] })
  assert.equal(value.components[0].lunaSku,
    "Jhoel-Food Scale-with Nutritional-Calculator-B0CS36YWSB")
})

test("title-only, missing variant, and identity conflicts cannot approve", () => {
  for (const candidate of [
    entry({ classification: "IDENTITY_EVIDENCE_INCOMPLETE",
      components: [component({ quantityBasis: "TITLE_ONLY" })] }),
    entry({ classification: "CONFLICTING_MATCH",
      components: [component({ identityConflict: true })] }),
    entry({ classification: "IDENTITY_EVIDENCE_INCOMPLETE",
      components: [component({ variantPresence: "MISSING" })] }),
  ]) {
    assert.equal(candidate.approvalEligibility.eligible, false)
    assert.equal(candidate.allowedOperatorDecisions.includes(
      "APPROVE_EXACT_LINKAGE"), false)
  }
})

test("simple multiplier and complete multi-component BOM validate exactly", () => {
  const multiplier = entry({ linkageMode: "SIMPLE_MULTIPLIER",
    components: [component({ supplierQuantityRequired: 3,
      quantityBasis: "HUMAN_CONFIRMATION_REQUIRED" })] })
  assert.equal(multiplier.approvalEligibility.eligible, true)
  assert.equal(multiplier.supplierQuantityRequired, 3)

  const bom = entry({ ebayItemId: "366584136876",
    linkageMode: "MULTI_COMPONENT_BOM",
    components: [component(), component({
      lunaProductId: "9220818632928", lunaVariantId: "48809624535264",
      lunaSku: "ITEM4895",
    })] })
  assert.equal(bom.approvalEligibility.eligible, true)
  assert.equal(bom.components.length, 2)
  assert.equal(bom.supplierQuantityRequired, null)
})

test("invalid multiplier and incomplete BOM fail closed", () => {
  const scalar = entry({ linkageMode: "SIMPLE_MULTIPLIER",
    components: [component({ supplierQuantityRequired: 1 })] })
  assert.equal(scalar.approvalEligibility.eligible, false)
  assert.ok(scalar.approvalEligibility.reasonCodes.includes(
    "SIMPLE_MULTIPLIER_GRAIN_INVALID"))
  const incomplete = entry({ classification: "BUNDLE_INCOMPLETE",
    linkageMode: "MULTI_COMPONENT_BOM", components: [component()] })
  assert.equal(incomplete.approvalEligibility.eligible, false)
  assert.equal(incomplete.allowedOperatorDecisions.includes(
    "APPROVE_EXACT_LINKAGE"), false)
})

test("no-match review has an unresolved grain and can only stay unproven", () => {
  const missing = entry({ classification: "NO_MATCH",
    linkageMode: "UNRESOLVED", components: [],
    matchSignals: [], conflictSignals: ["NO_CURRENT_LUNA_MATCH"],
    evidenceReferences: [
      `luna-identity-v1:sha256:${"d".repeat(64)}`,
    ] })
  assert.equal(missing.linkageId, null)
  assert.equal(missing.approvalEligibility.eligible, false)
  assert.deepEqual(missing.allowedOperatorDecisions, ["KEEP_UNPROVEN"])
})

test("request parser accepts exactly six server-bound fields", () => {
  const parsed = parseSellerOsLunaLinkageApprovalRequestV1(request())
  assert.equal(parsed.decision, "APPROVE_EXACT_LINKAGE")
  assert.deepEqual(Object.keys(parsed).sort(), [
    "candidateEvidenceDigest", "currentCohortId", "decision",
    "decisionVersion", "ebayItemId", "reviewSetId",
  ])
})

test("caller-injected Luna identity, URL, account, or extra object is rejected", () => {
  for (const injected of [
    { lunaProductId: "caller-product" },
    { lunaVariantId: "caller-variant" },
    { url: "https://example.com" },
    { accountKey: "other-account" },
    { components: [component()] },
  ]) assert.throws(() => parseSellerOsLunaLinkageApprovalRequestV1({
    ...request(), ...injected,
  }), /LUNA_LINKAGE_APPROVAL_CALLER_INPUT_REJECTED/)
})

test("only an authenticated human admin may cross the gate", () => {
  assert.equal(assertSellerOsLunaLinkageApprovalAdminV1({
    ok: true, userId: ACTOR, authenticationMode: "admin_user",
  }), ACTOR)
  for (const validation of [
    { ok: false, userId: ACTOR, authenticationMode: "admin_user" },
    { ok: true, userId: null, authenticationMode: "service_role" },
    { ok: true, userId: ACTOR, authenticationMode: "service_role" },
  ]) assert.throws(() => assertSellerOsLunaLinkageApprovalAdminV1(validation),
    /LUNA_LINKAGE_APPROVAL_ADMIN_USER_REQUIRED/)
})

test("CSRF is strong, single-use, TTL-bounded, session/origin/review-bound", () => {
  const h = csrfHarness()
  const issued = h.issue()
  assert.match(issued.csrfToken, /^lc1\.[A-Za-z0-9_-]{43}$/)
  assert.equal(issued.singleUse, true)
  assert.equal(h.consume(issued.csrfToken).actorUserId, ACTOR)
  assert.throws(() => h.consume(issued.csrfToken),
    /LUNA_LINKAGE_APPROVAL_CSRF_REUSED/)

  const expired = h.issue()
  h.advance(SELLER_OS_LUNA_LINKAGE_APPROVAL_CSRF_TTL_MS + 1)
  assert.throws(() => h.consume(expired.csrfToken),
    /LUNA_LINKAGE_APPROVAL_CSRF_REJECTED|LUNA_LINKAGE_APPROVAL_CSRF_EXPIRED/)

  const wrongSubject = h.issue()
  assert.throws(() => h.consume(wrongSubject.csrfToken, {
    reviewSetDigest: `sha256:${"b".repeat(64)}`,
  }), /LUNA_LINKAGE_APPROVAL_CSRF_SUBJECT_MISMATCH/)
  assert.throws(() => h.consume(wrongSubject.csrfToken, {
    origin: "http://127.0.0.1:3001",
  }), /LUNA_LINKAGE_APPROVAL_CSRF_REJECTED/)
  assert.throws(() => h.consume(wrongSubject.csrfToken, {
    adminSessionToken: `other-session-${"b".repeat(64)}`,
  }), /LUNA_LINKAGE_APPROVAL_CSRF_SUBJECT_MISMATCH/)
})

test("same protocol and port loopback aliases share the closed origin binding", () => {
  const h = csrfHarness()
  const issued = h.issue()
  assert.equal(h.consume(issued.csrfToken, {
    requestUrl:
      "http://127.0.0.1:3000/api/admin/ebay/luna-supplier-linkage-review",
    origin: "http://[::1]:3000",
  }).actorUserId, ACTOR)
})

test("stale cohort, unknown item, changed digest, and changed version fail", async () => {
  const review = reviewSet()
  await assert.rejects(() => execute({ review, body: request(review, {
    reviewSetId: `luna-linkage-review-set-v1:sha256:${"b".repeat(64)}`,
  }) }), /LUNA_LINKAGE_APPROVAL_STALE_REVIEW_REJECTED/)
  await assert.rejects(() => execute({ review, body: request(review, {
    currentCohortId: `current-live:EBAY_US:${"b".repeat(24)}`,
  }) }), /LUNA_LINKAGE_APPROVAL_STALE_COHORT_REJECTED/)
  await assert.rejects(() => execute({ review, body: request(review, {
    ebayItemId: "366999999999",
  }) }), /LUNA_LINKAGE_APPROVAL_CURRENT_COHORT_ITEM_REQUIRED/)
  await assert.rejects(() => execute({ review, body: request(review, {
    candidateEvidenceDigest: `sha256:${"b".repeat(64)}`,
  }) }), /LUNA_LINKAGE_APPROVAL_STALE_REVIEW_REJECTED/)
  await assert.rejects(() => execute({ review, body: request(review, {
    decisionVersion: 2,
  }) }), /LUNA_LINKAGE_APPROVAL_STALE_REVIEW_REJECTED/)
})

test("current review evidence is revalidated at decision time", async () => {
  let callbacks = 0
  const store = async (decision) => {
    callbacks += 1
    return { outcome: "CREATED",
      decisionReference: decision.decisionReference }
  }
  await assert.rejects(() => execute({
    review: reviewSet(),
    store,
    now: () => "2026-08-22T21:30:01.000Z",
  }), /LUNA_LINKAGE_APPROVAL_STALE_REVIEW_REJECTED/)
  assert.equal(callbacks, 0)

  await assert.rejects(() => execute({
    review: reviewSet(),
    store,
    now: () => "2026-08-22T15:24:59.000Z",
  }), /LUNA_LINKAGE_APPROVAL_CLOCK_INVALID/)
  assert.equal(callbacks, 0)
})

test("server-side allowed decisions block approval of incomplete evidence", async () => {
  const review = reviewSet([entry({ classification: "BUNDLE_INCOMPLETE",
    linkageMode: "MULTI_COMPONENT_BOM", components: [component()] })])
  await assert.rejects(() => execute({ review, body: request(review) }),
    /LUNA_LINKAGE_APPROVAL_DECISION_NOT_ALLOWED/)
  const kept = await execute({ review, body: request(review, {
    decision: "KEEP_UNPROVEN",
  }) })
  assert.equal(kept.status, "CREATED")
  assert.equal(kept.humanApprovalRecorded, false)
})

test("fresh-CSRF replay is idempotent and conflicting decision needs a new version", async () => {
  const review = reviewSet()
  const store = memoryStore()
  const first = await execute({ review, store })
  const replay = await execute({ review, store })
  assert.equal(first.status, "CREATED")
  assert.equal(replay.status, "IDEMPOTENT_SUCCESS")
  assert.equal(first.decisionReference, replay.decisionReference)
  await assert.rejects(() => execute({ review, store, body: request(review, {
    decision: "REJECT_CANDIDATE",
  }) }), /LUNA_LINKAGE_APPROVAL_CONFLICT_REQUIRES_NEW_DECISION_VERSION/)
})

test("restart invalidates old CSRF but durable decision replay remains idempotent", async () => {
  const review = reviewSet()
  const old = csrfHarness(review)
  const token = old.issue().csrfToken
  const restarted = csrfHarness(review)
  assert.throws(() => restarted.consume(token),
    /LUNA_LINKAGE_APPROVAL_CSRF_REJECTED/)

  const store = memoryStore()
  assert.equal((await execute({ review, store })).status, "CREATED")
  assert.equal((await execute({ review, store })).status,
    "IDEMPOTENT_SUCCESS")
})

test("review evidence and linkage identity replay deterministically", () => {
  const first = entry()
  const second = entry()
  assert.equal(first.evidenceDigest, second.evidenceDigest)
  assert.equal(first.linkageId, second.linkageId)
  const reversed = entry({ linkageMode: "MULTI_COMPONENT_BOM",
    components: [component({ lunaProductId: "9220818632928",
      lunaVariantId: "48809624535264", lunaSku: "OTHER" }), component()] })
  const forward = entry({ linkageMode: "MULTI_COMPONENT_BOM",
    components: [...reversed.components].reverse() })
  assert.equal(reversed.linkageId, forward.linkageId)
})

test("candidate identities are scoped to the complete review set", () => {
  const firstEntry = entry({ ebayItemId: "366582586826" })
  const secondEntry = entry({ ebayItemId: "366584136876" })
  const firstSet = reviewSet([firstEntry, secondEntry])
  const replay = reviewSet([firstEntry, secondEntry])
  assert.deepEqual(firstSet.entries.map((candidate) =>
    candidate.reviewCandidateId), replay.entries.map((candidate) =>
    candidate.reviewCandidateId))

  const refreshedSecond = entry({ ebayItemId: "366584136876",
    matchSignals: ["EXACT_SUPPLIER_SKU", "EXACT_VARIANT_ATTRIBUTES",
      "CURRENT_PRODUCT_IDENTITY_REFRESHED"] })
  const refreshedSet = reviewSet([firstEntry, refreshedSecond])
  assert.notEqual(firstSet.reviewSetId, refreshedSet.reviewSetId)
  for (const original of firstSet.entries) {
    const refreshed = refreshedSet.entries.find((candidate) =>
      candidate.ebayItemId === original.ebayItemId)
    assert.ok(refreshed)
    assert.notEqual(original.reviewCandidateId, refreshed.reviewCandidateId)
    assert.equal(original.linkageId, refreshed.linkageId)
  }
})

test("control plane performs no writes without the injected callback", async () => {
  let callbacks = 0
  let durableInput = null
  const result = await execute({ store: async (decision) => {
    callbacks += 1
    durableInput = decision
    return { outcome: "CREATED",
      decisionReference: decision.decisionReference }
  } })
  assert.equal(callbacks, 1)
  assert.equal(durableInput.reviewObservedAt, OBSERVED_AT)
  assert.equal(durableInput.evidenceMaximumAgeSeconds,
    SELLER_OS_LUNA_LINKAGE_IDENTITY_EVIDENCE_MAXIMUM_AGE_SECONDS)
  assert.equal(durableInput.evidenceFreshness, "CURRENT")
  assert.deepEqual(durableInput.identityEvidenceProvenance,
    CURRENT_IDENTITY_PROVENANCE)
  assert.equal(result.safety.ebayWrites, 0)
  assert.equal(result.safety.marketplaceWrites, 0)
  assert.equal(result.safety.stockEvaluated, false)
})
