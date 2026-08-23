import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { registerHooks } from "node:module"
import test from "node:test"

registerHooks({
  resolve(specifier, context, nextResolve) {
    const value = String(specifier)
    if (value === "server-only") {
      return { url: "data:text/javascript,export default {}", shortCircuit: true }
    }
    if (value.startsWith(".") && !/\.(?:ts|mjs|js|json)$/.test(value)) {
      return nextResolve(`${value}.ts`, context)
    }
    return nextResolve(specifier, context)
  },
})

const { dispatchSellerOsBuyerThankYouV1 } = await import(
  "./ebay-buyer-thank-you-dispatcher-v1.ts"
)
const { EbayBuyerThankYouDeliveryError,
  sellerOsBuyerThankYouDeliveryKeyV1 } = await import(
  "./ebay-post-purchase-buyer-message-v1.ts"
)

const ACCOUNT = "EBAY_US:SELLER_PRIMARY"
const NOW = new Date("2026-08-21T05:30:00.000Z")
const EVENT_ID = `commercial-v1:${"a".repeat(64)}`

function fakeSupabase() {
  const rows = []
  let sequence = 0
  function matches(row, column, value) {
    if (column.startsWith("evidence->>")) {
      return String(row.evidence?.[column.slice("evidence->>".length)] ?? "") ===
        String(value)
    }
    return row[column] === value
  }
  function from(table) {
    assert.equal(table, "commercial_alert_events")
    let operation = "select"
    let payload = null
    const filters = []
    const execute = () => {
      if (operation === "insert") {
        if (rows.some((row) => row.deduplication_key ===
            payload.deduplication_key)) {
          return { data: null, error: { code: "23505" } }
        }
        const inserted = { id: `ledger-${++sequence}`, created_at: NOW.toISOString(),
          ...payload }
        rows.push(inserted)
        return { data: inserted, error: null }
      }
      const selected = rows.filter((row) => filters.every(([column, value]) =>
        matches(row, column, value)))
      if (operation === "update") {
        for (const row of selected) Object.assign(row, payload)
      }
      return { data: operation === "update" ? selected : selected,
        error: null }
    }
    const builder = {
      select() { return builder },
      eq(column, value) { filters.push([column, value]); return builder },
      insert(value) { operation = "insert"; payload = value; return builder },
      update(value) { operation = "update"; payload = value; return builder },
      maybeSingle() {
        const result = execute()
        return Promise.resolve({ data: Array.isArray(result.data)
          ? result.data[0] ?? null : result.data, error: result.error })
      },
      then(resolve, reject) {
        return Promise.resolve(execute()).then(resolve, reject)
      },
    }
    return builder
  }
  return { supabase: { from }, rows }
}

function entry(overrides = {}) {
  const orderId = overrides.orderId ?? "ORDER-ONE"
  const eventIds = overrides.eventIds ?? [EVENT_ID]
  return {
    orderId,
    eventIds,
    primaryCorrelationEventId: eventIds[0],
    lineItemIds: overrides.lineItemIds ?? ["LINE-ONE"],
    itemIds: overrides.itemIds ?? ["366575102453"],
    orderCreatedAt: "2026-08-21T05:00:00.000Z",
    templateVersion: "POST_PURCHASE_THANK_YOU_TEMPLATE_V1",
    deliveryKey: sellerOsBuyerThankYouDeliveryKeyV1({ orderId, eventIds }),
    detectionClass: "NEWLY_DETECTED_AFTER_ACTIVATION",
    eligibleForBuyerThankYou: true,
    ...overrides,
  }
}

function status(entries = [entry()]) {
  return { sourceStatus: "AVAILABLE", entries }
}

function capability(overrides = {}) {
  return {
    status: "READY",
    deliveryAttemptAllowed: true,
    automaticExecutionAuthority: "AUTO_EXECUTION_ALLOWED",
    ...overrides,
  }
}

function successPreparer(counter) {
  return async () => ({
    prepared: true,
    recipientIdentityExposed: false,
    rawOrderPayloadExposed: false,
    credentialsExposed: false,
    send: async () => {
      counter.count += 1
      return { accepted: true, provider: "EBAY_COMMERCE_MESSAGE_API",
        providerReferenceDigest: `sha256:${"b".repeat(64)}`,
        acceptedAt: NOW.toISOString(), recipientIdentityExposed: false,
        rawProviderPayloadExposed: false, credentialsExposed: false }
    },
  })
}

function input(fake, overrides = {}) {
  return {
    supabase: fake.supabase,
    accountKey: ACCOUNT,
    status: status(),
    capability: capability(),
    workerId: "buyer-thank-you:test-worker",
    now: () => new Date(NOW),
    ...overrides,
  }
}

test("new eligible order sends once, persists receipt and replay never resends", async () => {
  const fake = fakeSupabase()
  const sends = { count: 0 }
  const first = await dispatchSellerOsBuyerThankYouV1(input(fake, {
    prepareDispatch: successPreparer(sends),
  }))
  const replay = await dispatchSellerOsBuyerThankYouV1(input(fake, {
    prepareDispatch: successPreparer(sends),
  }))
  assert.equal(first.accepted, 1)
  assert.equal(first.buyerMessageSends, 1)
  assert.equal(first.marketplaceWrites, 1)
  assert.ok(first.databaseMaintenanceWrites >= 3)
  assert.equal(replay.accepted, 0)
  assert.equal(sends.count, 1)
  assert.equal(fake.rows.length, 1)
  assert.equal(fake.rows[0].evidence.workflowState, "SUCCEEDED")
  assert.equal(fake.rows[0].evidence.receiptStatus, "PRESENT")
  assert.match(fake.rows[0].evidence.providerReferenceDigest,
    /^sha256:[0-9a-f]{64}$/)
  assert.equal(fake.rows[0].evidence.buyerPiiIncluded, false)
})

test("100 concurrent duplicate workers preserve one logical delivery", async () => {
  const fake = fakeSupabase()
  const sends = { count: 0 }
  await Promise.all(Array.from({ length: 100 }, (_, index) =>
    dispatchSellerOsBuyerThankYouV1(input(fake, {
      workerId: `buyer-thank-you:worker-${index}`,
      prepareDispatch: successPreparer(sends),
    }))))
  assert.equal(sends.count, 1)
  assert.equal(fake.rows.length, 1)
})

test("historical replay is never reserved or sent", async () => {
  const fake = fakeSupabase()
  const sends = { count: 0 }
  const historical = entry({ detectionClass: "HISTORICAL_REPLAY",
    eligibleForBuyerThankYou: false })
  const result = await dispatchSellerOsBuyerThankYouV1(input(fake, {
    status: status([historical]),
    prepareDispatch: successPreparer(sends),
  }))
  assert.equal(result.eligibleOrders, 0)
  assert.equal(result.buyerMessageSends, 0)
  assert.equal(sends.count, 0)
  assert.equal(fake.rows.length, 0)
})

test("safe pre-dispatch failure retries the same delivery key then succeeds", async () => {
  const fake = fakeSupabase()
  const sends = { count: 0 }
  let preparations = 0
  const prepareDispatch = async () => {
    preparations += 1
    if (preparations === 1) throw new EbayBuyerThankYouDeliveryError({
      code: "EBAY_BUYER_CONTEXT_READ_503", phase: "PRE_DISPATCH",
      retrySafe: true, acceptanceOutcome: "NOT_ATTEMPTED",
    })
    return successPreparer(sends)()
  }
  const failed = await dispatchSellerOsBuyerThankYouV1(input(fake, {
    prepareDispatch,
  }))
  const recovered = await dispatchSellerOsBuyerThankYouV1(input(fake, {
    prepareDispatch,
    now: () => new Date(NOW.getTime() + 1_000),
  }))
  assert.equal(failed.failed, 1)
  assert.equal(recovered.accepted, 1)
  assert.equal(sends.count, 1)
  assert.equal(fake.rows.length, 1)
  assert.equal(fake.rows[0].evidence.workflowState, "SUCCEEDED")
  assert.equal(fake.rows[0].evidence.attemptCount, 2)
})

test("unknown provider acceptance is quarantined and never retried", async () => {
  const fake = fakeSupabase()
  let sends = 0
  const prepareDispatch = async () => ({
    prepared: true,
    send: async () => {
      sends += 1
      throw new EbayBuyerThankYouDeliveryError({
        code: "EBAY_BUYER_MESSAGE_ACCEPTANCE_OUTCOME_UNKNOWN",
        phase: "POST_DISPATCH", retrySafe: false,
        acceptanceOutcome: "UNKNOWN",
      })
    },
  })
  const first = await dispatchSellerOsBuyerThankYouV1(input(fake, {
    prepareDispatch,
  }))
  const replay = await dispatchSellerOsBuyerThankYouV1(input(fake, {
    prepareDispatch,
  }))
  assert.equal(first.manualReviewRequired, 1)
  assert.equal(replay.attempted, 0)
  assert.equal(sends, 1)
  assert.equal(fake.rows[0].evidence.workflowState, "BLOCKED")
  assert.equal(fake.rows[0].evidence.receiptStatus, "UNKNOWN_OUTCOME")
  assert.equal(fake.rows[0].evidence.manualReviewRequired, true)
})

test("two orders have independent order-level delivery keys", async () => {
  const fake = fakeSupabase()
  const sends = { count: 0 }
  const secondEvent = `commercial-v1:${"c".repeat(64)}`
  const entries = [entry(), entry({ orderId: "ORDER-TWO",
    eventIds: [secondEvent], lineItemIds: ["LINE-TWO"],
    itemIds: ["366575102454"] })]
  const result = await dispatchSellerOsBuyerThankYouV1(input(fake, {
    status: status(entries),
    prepareDispatch: successPreparer(sends),
  }))
  assert.equal(result.accepted, 2)
  assert.equal(sends.count, 2)
  assert.equal(fake.rows.length, 2)
  assert.notEqual(entries[0].deliveryKey, entries[1].deliveryKey)
})

test("missing authority is blocked without database or marketplace side effects", async () => {
  const fake = fakeSupabase()
  const sends = { count: 0 }
  const result = await dispatchSellerOsBuyerThankYouV1(input(fake, {
    capability: capability({ status: "AUTHORIZATION_BLOCKED",
      deliveryAttemptAllowed: false,
      automaticExecutionAuthority: "HUMAN_APPROVAL_REQUIRED" }),
    prepareDispatch: successPreparer(sends),
  }))
  assert.equal(result.status, "BLOCKED")
  assert.equal(result.databaseMaintenanceWrites, 0)
  assert.equal(result.marketplaceWrites, 0)
  assert.equal(result.buyerMessageSends, 0)
  assert.equal(fake.rows.length, 0)
})

test("dispatcher is not an MCP surface and has no caller recipient or URL", () => {
  const source = readFileSync(new URL(
    "./ebay-buyer-thank-you-dispatcher-v1.ts", import.meta.url,
  ), "utf8")
  assert.doesNotMatch(source, /registerTool|recipient\s*:\s*input|url\s*:\s*input/i)
  assert.doesNotMatch(source, /console\.|logger\./)
  assert.match(source, /prepareEbayBuyerThankYouDispatchV1/)
  assert.match(source, /UNKNOWN_OUTCOME/)
})
