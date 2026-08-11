import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import test from "node:test"

const migration = readFileSync(
  new URL(
    "../supabase/migrations/20260811010000_create_atomic_ebay_registry_repair_rpc.sql",
    import.meta.url,
  ),
  "utf8",
)

const ACCOUNT = `official:${"a".repeat(64)}`
const SOURCE = "EBAY_TRADING_GET_MY_EBAY_SELLING"
const PACKAGE = `rr_package_${"b".repeat(24)}`
const EVIDENCE = `rr_evidence_${"c".repeat(24)}`
const OBSERVED_AT = "2026-08-11T12:00:00.000Z"

function clone(value) {
  return JSON.parse(JSON.stringify(value))
}

function createCandidate(index, sku = `SAFE-SKU-${index}`) {
  const itemId = String(1_000_000_000 + index)
  return {
    source: SOURCE,
    account_key: ACCOUNT,
    sync_key: `${SOURCE}:${ACCOUNT}:${itemId}`,
    ebay_item_id: itemId,
    title: `Fixture listing ${index}`,
    ebay_sku: sku,
    ebay_quantity: 1,
    ebay_price: "19.99",
    currency: "USD",
    last_ebay_sync_at: OBSERVED_AT,
    raw_payload: {
      source: SOURCE,
      marketplaceId: "EBAY_US",
      listingState: "ACTIVE",
      variationKey: "",
      observedAt: OBSERVED_AT,
    },
  }
}

function registryRow(index, overrides = {}) {
  const itemId = String(2_000_000_000 + index)
  return {
    id: `00000000-0000-4000-8000-${String(index).padStart(12, "0")}`,
    accountKey: ACCOUNT,
    source: SOURCE,
    syncKey: `${SOURCE}:${ACCOUNT}:${itemId}`,
    itemId,
    sku: `OLD-SKU-${index}`,
    status: "active",
    syncGeneration: 7,
    updatedAt: "2026-08-11T11:55:00.000Z",
    ...overrides,
  }
}

function staleCandidate(row) {
  return {
    id: row.id,
    account_key: row.accountKey,
    expected_source: row.source,
    expected_sync_key: row.syncKey,
    expected_listing_status: row.status,
    expected_ebay_item_id: row.itemId,
    expected_ebay_sku: row.sku,
    expected_sync_generation: row.syncGeneration,
    expected_updated_at: row.updatedAt,
  }
}

function unsafeRawPayload(payload) {
  const allowed = new Set([
    "source", "marketplaceId", "listingState", "variationKey",
    "observedAt", "offerId", "categoryId", "offerStatus",
    "opportunityMappingState", "opportunityMappingSource",
  ])
  if (!payload || Array.isArray(payload) || typeof payload !== "object") return true
  if (Object.keys(payload).some((key) => !allowed.has(key))) return true
  if (
    payload.source !== SOURCE ||
    payload.marketplaceId !== "EBAY_US" ||
    payload.listingState !== "ACTIVE" ||
    typeof payload.observedAt !== "string"
  ) return true
  if (Object.values(payload).some((value) => value && typeof value === "object")) return true
  return /private key|\bsk-(?:proj-)?[\w-]{20,}|sb_secret_|bearer\s+[\w.-]{20,}|[\w.%+-]+@[\w.-]+\.[a-z]{2,}|buyer|shipping|address|payment|cookie|authorization|refresh.?token|access.?token/i
    .test(JSON.stringify(payload))
}

function applyFixtureTransaction(state, input, options = {}) {
  const fail = (code) => {
    const error = new Error(code)
    error.code = code
    throw error
  }
  const original = clone(state)
  const work = clone(state)
  const creates = clone(input.createCandidates)
  const stales = clone(input.staleCandidates)

  if (
    input.accountKey !== ACCOUNT ||
    !/^rr_package_[0-9a-f]{24}$/.test(input.packageHandle) ||
    !/^rr_evidence_[0-9a-f]{24}$/.test(input.evidenceFingerprint)
  ) fail("INPUT_INVALID")
  if (
    creates.length !== input.expectedCreateCount ||
    stales.length !== input.expectedStaleCount
  ) fail("COUNT_MISMATCH")
  if (input.expectedHumanReviewCount < 0) fail("INPUT_INVALID")

  const createItems = new Set()
  const createKeys = new Set()
  for (const candidate of creates) {
    if (candidate.account_key !== input.accountKey) fail("ACCOUNT_SCOPE_MISMATCH")
    if (!/^\d{9,20}$/.test(candidate.ebay_item_id)) fail("INPUT_INVALID")
    if (candidate.sync_key !== `${candidate.source}:${input.accountKey}:${candidate.ebay_item_id}`) {
      fail("INPUT_INVALID")
    }
    if (unsafeRawPayload(candidate.raw_payload)) fail("RAW_PAYLOAD_UNSAFE")
    if (createItems.has(candidate.ebay_item_id) || createKeys.has(candidate.sync_key)) {
      fail("INPUT_INVALID")
    }
    createItems.add(candidate.ebay_item_id)
    createKeys.add(candidate.sync_key)
  }

  const staleIds = new Set()
  for (const candidate of stales) {
    if (candidate.account_key !== input.accountKey) fail("ACCOUNT_SCOPE_MISMATCH")
    if (staleIds.has(candidate.id)) fail("INPUT_INVALID")
    if (
      createItems.has(candidate.expected_ebay_item_id) ||
      (candidate.expected_sync_key && createKeys.has(candidate.expected_sync_key))
    ) fail("ACTION_SET_OVERLAP")
    staleIds.add(candidate.id)
  }

  for (const candidate of creates) {
    if (work.rows.some((row) => row.syncKey === candidate.sync_key)) {
      fail("SYNC_KEY_COLLISION")
    }
    if (work.rows.some((row) => row.itemId === candidate.ebay_item_id)) {
      fail("CREATE_ABSENCE_CAS_FAILED")
    }
  }

  for (const candidate of stales) {
    const row = work.rows.find((value) => value.id === candidate.id)
    if (
      !row ||
      row.accountKey !== candidate.account_key ||
      row.source !== candidate.expected_source ||
      row.syncKey !== candidate.expected_sync_key ||
      row.status !== candidate.expected_listing_status ||
      row.itemId !== candidate.expected_ebay_item_id ||
      row.sku !== candidate.expected_ebay_sku ||
      row.syncGeneration !== candidate.expected_sync_generation ||
      row.updatedAt !== candidate.expected_updated_at
    ) fail("STALE_ROW_CAS_FAILED")
  }

  for (const candidate of creates) {
    work.rows.push({
      id: `created-${candidate.ebay_item_id}`,
      accountKey: input.accountKey,
      source: candidate.source,
      syncKey: candidate.sync_key,
      itemId: candidate.ebay_item_id,
      sku: candidate.ebay_sku,
      status: "active",
      syncGeneration: 0,
      updatedAt: OBSERVED_AT,
    })
  }
  for (const candidate of stales) {
    const row = work.rows.find((value) => value.id === candidate.id)
    row.status = "ended"
    row.updatedAt = OBSERVED_AT
  }

  if (options.forceAffectedRowMismatch) fail("AFFECTED_ROW_COUNT_MISMATCH")
  if (
    creates.filter((candidate) => work.rows.some((row) =>
      row.itemId === candidate.ebay_item_id && row.status === "active")).length !== creates.length ||
    stales.filter((candidate) => work.rows.some((row) =>
      row.id === candidate.id && row.status === "ended")).length !== stales.length
  ) fail("AFFECTED_ROW_COUNT_MISMATCH")

  return {
    original,
    state: work,
    result: {
      status: "APPLIED",
      createInserted: creates.length,
      staleUpdated: stales.length,
      repairUpdated: 0,
      humanReviewMutated: 0,
    },
  }
}

function fixture() {
  const staleRows = Array.from({ length: 4 }, (_, index) => registryRow(index + 1))
  const humanReviewRows = Array.from({ length: 3 }, (_, index) =>
    registryRow(index + 101, { status: index === 2 ? "unknown" : "active" }))
  return {
    state: { rows: [...staleRows, ...humanReviewRows] },
    humanReviewRows,
    input: {
      accountKey: ACCOUNT,
      packageHandle: PACKAGE,
      evidenceFingerprint: EVIDENCE,
      expectedCreateCount: 24,
      expectedStaleCount: 4,
      expectedHumanReviewCount: 3,
      createCandidates: Array.from({ length: 24 }, (_, index) =>
        createCandidate(index + 1)),
      staleCandidates: staleRows.map(staleCandidate),
    },
  }
}

test("migration creates one narrow atomic Registry repair RPC and no schema objects", () => {
  assert.match(migration, /create or replace function public\.apply_ebay_registry_repair_v1\(/)
  assert.equal((migration.match(/create or replace function/gi) ?? []).length, 1)
  assert.doesNotMatch(migration, /\bcreate\s+table\b/i)
  assert.doesNotMatch(migration, /\balter\s+table\b/i)
  assert.doesNotMatch(migration, /\bcreate\s+(?:unique\s+)?index\b/i)
  assert.doesNotMatch(migration, /\bdelete\s+from\s+public\.ebay_active_listings\b/i)
  assert.match(migration, /lock table public\.ebay_active_listings in share row exclusive mode/)
  assert.match(migration, /ROLLBACK guarantees/i)
})

test("24 CREATE plus 4 STALE fixture commits atomically and excludes HUMAN_REVIEW", () => {
  const { state, input, humanReviewRows } = fixture()
  const applied = applyFixtureTransaction(state, input)
  assert.deepEqual(applied.result, {
    status: "APPLIED",
    createInserted: 24,
    staleUpdated: 4,
    repairUpdated: 0,
    humanReviewMutated: 0,
  })
  for (const review of humanReviewRows) {
    assert.deepEqual(applied.state.rows.find((row) => row.id === review.id), review)
  }
})

test("RPC exposes no repair or HUMAN_REVIEW mutation operation", () => {
  const signature = migration.slice(
    migration.indexOf("create or replace function"),
    migration.indexOf(")\nreturns table"),
  )
  assert.doesNotMatch(signature, /repair_candidates|human_review_candidates/i)
  assert.match(migration, /0,\n\s+0;\nexception/)
  assert.doesNotMatch(migration, /repair_updated\s*=/i)
})

for (const [name, mutate, expectedCode] of [
  ["CREATE absence failure", ({ state, input }) => {
    state.rows.push(registryRow(900, { itemId: input.createCandidates[0].ebay_item_id }))
  }, "CREATE_ABSENCE_CAS_FAILED"],
  ["sync_key collision", ({ state, input }) => {
    state.rows.push(registryRow(901, { syncKey: input.createCandidates[0].sync_key }))
  }, "SYNC_KEY_COLLISION"],
  ["STALE CAS failure", ({ input }) => {
    input.staleCandidates[0].expected_sync_generation += 1
  }, "STALE_ROW_CAS_FAILED"],
  ["account scope mismatch", ({ input }) => {
    input.createCandidates[0].account_key = `other:${"d".repeat(64)}`
  }, "ACCOUNT_SCOPE_MISMATCH"],
]) {
  test(`${name} leaves the complete fixture unchanged`, () => {
    const context = fixture()
    mutate(context)
    const before = clone(context.state)
    assert.throws(
      () => applyFixtureTransaction(context.state, context.input),
      (error) => error.code === expectedCode,
    )
    assert.deepEqual(context.state, before)
  })
}

test("affected-row mismatch rolls back CREATE and STALE together", () => {
  const { state, input } = fixture()
  const before = clone(state)
  assert.throws(
    () => applyFixtureTransaction(state, input, { forceAffectedRowMismatch: true }),
    (error) => error.code === "AFFECTED_ROW_COUNT_MISMATCH",
  )
  assert.deepEqual(state, before)
})

test("cross-action overlap is rejected before mutation", () => {
  const { state, input } = fixture()
  input.staleCandidates[0].expected_ebay_item_id = input.createCandidates[0].ebay_item_id
  assert.throws(
    () => applyFixtureTransaction(state, input),
    (error) => error.code === "ACTION_SET_OVERLAP",
  )
})

test("duplicate CREATE Item ID and sync_key are rejected", () => {
  const { state, input } = fixture()
  input.createCandidates[1] = clone(input.createCandidates[0])
  assert.throws(
    () => applyFixtureTransaction(state, input),
    (error) => error.code === "INPUT_INVALID",
  )
})

test("duplicate STALE target is rejected", () => {
  const { state, input } = fixture()
  input.staleCandidates[1] = clone(input.staleCandidates[0])
  assert.throws(
    () => applyFixtureTransaction(state, input),
    (error) => error.code === "INPUT_INVALID",
  )
})

test("duplicate mutable SKU does not reject otherwise distinct CREATE rows", () => {
  const { state, input } = fixture()
  input.createCandidates[0].ebay_sku = "SHARED-MUTABLE-SKU"
  input.createCandidates[1].ebay_sku = "SHARED-MUTABLE-SKU"
  const applied = applyFixtureTransaction(state, input)
  assert.equal(applied.result.createInserted, 24)
})

test("successful package replay fails closed with zero new mutations", () => {
  const { state, input } = fixture()
  const first = applyFixtureTransaction(state, input)
  const committed = clone(first.state)
  assert.throws(
    () => applyFixtureTransaction(first.state, input),
    (error) => ["SYNC_KEY_COLLISION", "CREATE_ABSENCE_CAS_FAILED"].includes(error.code),
  )
  assert.deepEqual(first.state, committed)
})

for (const [name, patch] of [
  ["secret", { accessToken: `sk-${"x".repeat(32)}` }],
  ["authorization header", { authorization: `Bearer ${"x".repeat(32)}` }],
  ["buyer email", { buyerEmail: "buyer@example.test" }],
  ["shipping address", { shippingAddress: "fixture street" }],
]) {
  test(`forbidden raw_payload ${name} is rejected`, () => {
    const { state, input } = fixture()
    Object.assign(input.createCandidates[0].raw_payload, patch)
    assert.throws(
      () => applyFixtureTransaction(state, input),
      (error) => error.code === "RAW_PAYLOAD_UNSAFE",
    )
  })
}

test("service-role-only SECURITY DEFINER permission boundary is explicit", () => {
  assert.match(migration, /language plpgsql\nsecurity definer/)
  assert.match(migration, /set search_path = pg_catalog, public, pg_temp/)
  assert.match(migration, /from public, anon, authenticated;/)
  assert.match(migration, /to service_role;/)
  assert.doesNotMatch(migration, /\bexecute\s+format\b|\bexecute\s+immediate\b/i)
})

test("DML scope is Registry-only and cannot write eBay, Product Case, or human review", () => {
  const dmlTargets = [...migration.matchAll(/\b(?:insert into|update|delete from)\s+([a-z0-9_.]+)/gi)]
    .map((match) => match[1])
  assert.deepEqual([...new Set(dmlTargets)], ["public.ebay_active_listings"])
  assert.doesNotMatch(migration, /market_radar_products\s+(?:set|values)|product_case/i)
  assert.doesNotMatch(migration, /ebay.*(?:revise|additem|enditem)|fulfillment|oauth/i)
})
