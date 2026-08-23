import assert from "node:assert/strict"
import { registerHooks } from "node:module"
import test from "node:test"

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === "server-only") {
      return { shortCircuit: true, url: "data:text/javascript,export%20{}" }
    }
    const value = String(specifier)
    if (value.startsWith(".") &&
        !String(context.parentURL).includes("/node_modules/") &&
        !/\.(?:ts|mjs|js|json)$/.test(value)) {
      return nextResolve(`${value}.ts`, context)
    }
    return nextResolve(specifier, context)
  },
})

const {
  buildOrderPersistenceOrchestrationV1,
  orderExternalNotificationPlanV1,
  orderNotificationDispositionV1,
  persistOrdersAndSales,
} = await import("./ebay-commercial-monitor-service.ts")

const ACCOUNT = "EBAY_US:SELLER_PRIMARY"
const OBSERVED_AT = "2026-08-13T17:00:00.000Z"
const ITEM_A = "366575102453"
const ITEM_B = "366592919965"

function line(overrides = {}) {
  return {
    ebayOrderId: "ORDER-1",
    lineItemId: "LINE-1",
    listingId: ITEM_A,
    sku: "IMN-LST-000020",
    title: "Hearing Aids Hearing Amplifiers for Seniors",
    quantity: 1,
    lineItemAmount: 29.99,
    currency: "USD",
    shipByDate: "2026-08-15T23:59:59.000Z",
    ...overrides,
  }
}

function order(overrides = {}) {
  const ebayOrderId = overrides.ebayOrderId ?? "ORDER-1"
  return {
    ebayOrderId,
    creationDate: "2026-08-13T16:00:00.000Z",
    lastModifiedDate: "2026-08-13T16:01:00.000Z",
    orderPaymentStatus: "PAID",
    orderFulfillmentStatus: "NOT_STARTED",
    totalAmount: 29.99,
    currency: "USD",
    marketplaceId: "EBAY_US",
    ...overrides,
    lineItems: overrides.lineItems ?? [line({ ebayOrderId })],
  }
}

function listing(itemId = ITEM_A, sku = "IMN-LST-000020", overrides = {}) {
  return {
    id: `listing-${itemId}`,
    account_key: ACCOUNT,
    source: "EBAY_TRADING_GET_ITEM_READONLY",
    ebay_item_id: itemId,
    ebay_sku: sku,
    listing_status: "active",
    title: itemId === ITEM_A ? "Hearing Aids Hearing Amplifiers for Seniors" : "Second item",
    ebay_price: 29.99,
    currency: "USD",
    market_radar_product_id: null,
    supplier_variant_id: null,
    supplier_sku: null,
    supplier_cost_at_linking: null,
    last_ebay_sync_at: OBSERVED_AT,
    raw_payload: null,
    created_at: OBSERVED_AT,
    ...overrides,
  }
}

function project(overrides = {}) {
  return buildOrderPersistenceOrchestrationV1({
    accountKey: ACCOUNT,
    orders: [order()],
    listings: [listing()],
    supplies: [],
    observedAt: OBSERVED_AT,
    verifiedIdentities: new Set([`${ITEM_A}:IMN-LST-000020`]),
    whatsappCapability: "AVAILABLE",
    whatsappOperatorDestination: "AUTHORIZED",
    ...overrides,
  })
}

const WHATSAPP_TEST_ENV = {
  VERCEL_ENV: "preview",
  EBAY_PRO_RUNTIME: "staging",
  EBAY_SELLER_WHATSAPP_ENABLED: "true",
  EBAY_SELLER_WHATSAPP_RECIPIENT: "15555550100",
  WHATSAPP_PHONE_NUMBER_ID: "test-phone-id",
  WHATSAPP_BUSINESS_ACCOUNT_ID: "test-business-id",
  WHATSAPP_ACCESS_TOKEN: "test-token-never-sent",
  EBAY_SELLER_WHATSAPP_TEMPLATE_NAME: "test_sale_alert",
  EBAY_SELLER_WHATSAPP_DIGEST_TEMPLATE_NAME: "test_digest",
}

async function withWhatsappConfiguration(enabled, action) {
  const names = Object.keys(WHATSAPP_TEST_ENV)
  const previous = Object.fromEntries(names.map((name) =>
    [name, process.env[name]]))
  try {
    for (const [name, value] of Object.entries(WHATSAPP_TEST_ENV)) {
      process.env[name] = value
    }
    if (!enabled) process.env.EBAY_SELLER_WHATSAPP_ENABLED = "false"
    return await action()
  } finally {
    for (const name of names) {
      if (previous[name] === undefined) delete process.env[name]
      else process.env[name] = previous[name]
    }
  }
}

function persistenceInput(fake, overrides = {}) {
  return {
    supabase: fake.supabase,
    accountKey: ACCOUNT,
    orders: [],
    listings: [],
    supplies: [],
    thresholds: { version: "TEST_THRESHOLDS_V1" },
    observedAt: OBSERVED_AT,
    verifiedIdentities: new Set(),
    ...overrides,
  }
}

function fakePersistence(options = {}) {
  const tables = new Map([
    ["marketplace_order_snapshots", []],
    ["marketplace_order_line_items", []],
    ["commercial_alert_events", []],
    ["alert_delivery_outbox", []],
    ["fulfillment_tasks", []],
  ])
  let id = 0
  let outboxFailuresRemaining = options.outboxFailures ?? 0
  const rows = (table) => tables.get(table) ?? []
  const query = (table) => {
    const filters = []
    let operation = "select"
    let payload = null
    let maximum = null
    const execute = () => {
      if (operation === "upsert") {
        const target = rows(table)
        const orderKey = payload.marketplace_order_id
        const lineKey = payload.marketplace_line_item_id
        const existing = target.find((row) =>
          row.marketplace_account_key === payload.marketplace_account_key &&
          row.marketplace === payload.marketplace &&
          row.marketplace_order_id === orderKey &&
          (lineKey === undefined || row.marketplace_line_item_id === lineKey))
        if (existing) Object.assign(existing, payload)
        else target.push({ ...payload })
        return { data: null, error: null }
      }
      if (operation === "insert") {
        const target = rows(table)
        if (table === "alert_delivery_outbox" && outboxFailuresRemaining > 0) {
          outboxFailuresRemaining -= 1
          return { data: null, error: { code: "TRANSIENT_OUTBOX_FAILURE" } }
        }
        if (payload.deduplication_key && target.some((row) =>
          row.deduplication_key === payload.deduplication_key)) {
          return { data: null, error: { code: "23505" } }
        }
        const inserted = { id: `row-${++id}`, ...payload }
        target.push(inserted)
        return { data: inserted, error: null }
      }
      let selected = rows(table).filter((row) => filters.every((filter) =>
        filter(row)))
      if (maximum !== null) selected = selected.slice(0, maximum)
      return { data: selected, error: null }
    }
    const builder = {
      select() { return builder },
      eq(column, value) {
        filters.push((row) => row[column] === value)
        return builder
      },
      in(column, values) {
        filters.push((row) => values.includes(row[column]))
        return builder
      },
      limit(value) { maximum = value; return builder },
      maybeSingle() {
        const result = execute()
        return Promise.resolve({
          data: Array.isArray(result.data) ? result.data[0] ?? null : result.data,
          error: result.error,
        })
      },
      upsert(value) { operation = "upsert"; payload = value; return builder },
      insert(value) { operation = "insert"; payload = value; return builder },
      then(resolve, reject) {
        return Promise.resolve(execute()).then(resolve, reject)
      },
    }
    return builder
  }
  return {
    supabase: { from: query },
    rows,
  }
}

test("authoritative Order creates one sale independent of missing Luna", () => {
  const result = project({ supplies: [] })

  assert.equal(result.saleEventCount, 1)
  assert.equal(result.effects[0].saleEvent.status, "PROVEN")
  assert.equal(result.effects[0].saleEvent.attributionStatus, "PROVEN")
  assert.equal(result.effects[0].stockRecheck.state,
    "SUPPLIER_RECHECK_PENDING_LINK")
  assert.equal(result.effects[0].stockRecheck.stockInvented, false)
  assert.equal(result.effects[0].learningEvent.persistenceStatus,
    "PERSISTENCE_READY")
})

test("Registry/listing source failure never erases the authoritative sale", () => {
  const result = project({
    listings: [],
    supplies: [],
    verifiedIdentities: new Set(),
    listingSourceStatus: "UNAVAILABLE",
  })

  assert.equal(result.saleEventCount, 1)
  assert.equal(result.effects[0].saleEvent.status, "PROVEN")
  assert.equal(result.effects[0].saleEvent.itemIds[0], ITEM_A)
  assert.equal(result.effects[0].saleEvent.attributionStatus, "PROVEN")
  assert.equal(result.effects[0].saleEvent.lineEvents[0].attribution
    .localRelationshipStatus, "UNAVAILABLE")
  assert.equal(result.effects[0].whatsappOutboxAllowed, true)
})

test("WhatsApp failure is isolated from Order, sale, learning, and stock state", () => {
  const result = project({ whatsappCapability: "UNAVAILABLE" })

  assert.equal(result.saleEventCount, 1)
  assert.equal(result.effects[0].whatsappEligibility.status, "UNAVAILABLE")
  assert.equal(result.effects[0].whatsappOutboxAllowed, false)
  assert.equal(result.effects[0].learningEvent.persistenceStatus,
    "PERSISTENCE_READY")
  assert.equal(result.effects[0].stockRecheck.state,
    "SUPPLIER_RECHECK_PENDING_LINK")
})

test("multiple Order lines create one order-level sale and one notification plan", () => {
  const result = project({
    orders: [order({
      totalAmount: 49.99,
      lineItems: [
        line(),
        line({
          lineItemId: "LINE-2",
          listingId: ITEM_B,
          sku: "IMN-LST-000021",
          title: "Second item",
          quantity: 2,
          lineItemAmount: 20,
        }),
      ],
    })],
    listings: [listing(), listing(ITEM_B, "IMN-LST-000021")],
    verifiedIdentities: new Set([
      `${ITEM_A}:IMN-LST-000020`,
      `${ITEM_B}:IMN-LST-000021`,
    ]),
  })

  assert.equal(result.ingestion.orderLineEventCount, 2)
  assert.equal(result.saleEventCount, 1)
  assert.equal(result.effects.length, 1)
  assert.equal(result.effects[0].saleEvent.quantity, 3)
  assert.equal(result.effects[0].saleEvent.lineEvents[0].ebayItemId, ITEM_A)
  assert.deepEqual(result.effects[0].saleEvent.itemIds, [ITEM_A, ITEM_B])
  assert.equal(result.effects[0].whatsappOutboxAllowed, true)
})

test("cutover blocks backfill while a post-cutover retry may reserve its outbox", () => {
  const eligibility = project().effects[0].whatsappEligibility
  const retry = orderExternalNotificationPlanV1({
    historicalOrderObservation: false,
    saleEventCreated: false,
    whatsappEligibility: eligibility,
  })
  const historical = orderExternalNotificationPlanV1({
    historicalOrderObservation: true,
    saleEventCreated: true,
    whatsappEligibility: eligibility,
  })
  const fresh = orderExternalNotificationPlanV1({
    historicalOrderObservation: false,
    saleEventCreated: true,
    whatsappEligibility: eligibility,
  })

  assert.equal(retry.whatsappOutboxAllowed, true)
  assert.equal(retry.reasonCode,
    "POST_CUTOVER_PROVEN_SALE_OUTBOX_RESERVATION_ALLOWED")
  assert.equal(historical.whatsappOutboxAllowed, false)
  assert.equal(historical.reasonCode, "HISTORICAL_BACKFILL_NOTIFICATION_BLOCKED")
  assert.equal(fresh.whatsappOutboxAllowed, true)
  assert.equal(fresh.buyerMessageSendAllowed, false)
  assert.equal(fresh.historicalBackfillSendAllowed, false)
})

test("order notification disposition is based on soldAt cutover, not snapshots", () => {
  const historical = orderNotificationDispositionV1({
    soldAt: "2026-08-13T16:00:00.000Z",
    cutoverAt: "2026-08-13T17:00:00.000Z",
  })
  const postCutover = orderNotificationDispositionV1({
    soldAt: "2026-08-13T18:00:00.000Z",
    cutoverAt: "2026-08-13T17:00:00.000Z",
  })
  const legacy = orderNotificationDispositionV1({
    soldAt: "2026-08-13T18:00:00.000Z",
    cutoverAt: "2026-08-13T17:00:00.000Z",
    legacyLineSaleObservation: true,
  })

  assert.equal(historical.disposition, "HISTORICAL_RECOVERY")
  assert.equal(postCutover.disposition, "POST_CUTOVER_ORDER")
  assert.equal(legacy.disposition, "HISTORICAL_RECOVERY")
})

test("blocked buyer-message eligibility does not authorize or consume a send", () => {
  const effect = project().effects[0]

  assert.equal(effect.buyerMessageEligibility.status, "UNAVAILABLE")
  assert.equal(effect.buyerMessageEligibility.sendAllowed, false)
  assert.match(effect.buyerMessageEligibility.idempotencyKey,
    /^commercial-v1:[0-9a-f]{64}$/)
  assert.equal(orderExternalNotificationPlanV1({
    historicalOrderObservation: false,
    saleEventCreated: true,
    whatsappEligibility: effect.whatsappEligibility,
  }).buyerMessageSendAllowed, false)
})

test("orchestration never includes buyer PII or an unbounded write capability", () => {
  const serialized = JSON.stringify(project())

  assert.equal(project().buyerPiiIncluded, false)
  assert.doesNotMatch(serialized, /buyerName|buyerEmail|shipTo|addressLine|phone/i)
  assert.doesNotMatch(serialized, /reviseItem|endItem|inventoryWrite/i)
})

test("persistence reserves one Order sale before optional Registry or Luna work", async () => {
  const fake = fakePersistence()
  const emptyRead = await withWhatsappConfiguration(false, () =>
    persistOrdersAndSales(persistenceInput(fake, {
      observedAt: "2026-08-13T15:00:00.000Z",
    })))
  const input = persistenceInput(fake, {
    orders: [order()],
  })

  const first = await withWhatsappConfiguration(false, () =>
    persistOrdersAndSales(input))
  const second = await withWhatsappConfiguration(false, () =>
    persistOrdersAndSales(input))
  const eventTypes = fake.rows("commercial_alert_events").map((row) =>
    row.event_type)

  assert.equal(emptyRead.eventsCreated, 1)
  assert.equal(first.newSales, 1)
  assert.equal(first.tasksCreated, 0)
  assert.equal(first.alertsGenerated, 0)
  assert.equal(second.newSales, 0)
  assert.equal(eventTypes.filter((type) => type === "SALE_DETECTED").length, 1)
  assert.equal(eventTypes.filter((type) =>
    type === "SALE_TRIGGERED_STOCK_RECHECK").length, 1)
  assert.equal(eventTypes.filter((type) =>
    type === "COMMERCIAL_SALE_LEARNING_EVENT").length, 1)
  assert.equal(eventTypes.filter((type) =>
    type === "POST_PURCHASE_THANK_YOU_MESSAGE_AUDIT").length, 1)
  assert.equal(eventTypes.filter((type) =>
    type === "ORDER_NOTIFICATION_CUTOVER_ACTIVATED_V1").length, 1)
  assert.equal(fake.rows("alert_delivery_outbox").length, 0)
  assert.doesNotMatch(JSON.stringify(fake.rows("commercial_alert_events")),
    /buyerName|buyerEmail|shipTo|addressLine|phone/i)
})

test("multi-line persistence keeps an authoritative Item ID as event identity", async () => {
  const fake = fakePersistence()
  await persistOrdersAndSales({
    supabase: fake.supabase,
    accountKey: ACCOUNT,
    orders: [order({
      lineItems: [
        line(),
        line({
          lineItemId: "LINE-2",
          listingId: ITEM_B,
          sku: "IMN-LST-000021",
          title: "Second item",
        }),
      ],
    })],
    listings: [],
    supplies: [],
    thresholds: { version: "TEST_THRESHOLDS_V1" },
    observedAt: OBSERVED_AT,
    verifiedIdentities: new Set(),
  })

  const event = fake.rows("commercial_alert_events").find((row) =>
    row.event_type === "SALE_DETECTED")
  assert.equal(event.listing_id, ITEM_A)
  assert.deepEqual(event.evidence.itemIds, [ITEM_A, ITEM_B])
  assert.notEqual(event.listing_id, "MULTI_LINE_ORDER")
})

test("first successful Orders activation blocks historical notification backfill", async () => {
  const fake = fakePersistence()
  await withWhatsappConfiguration(true, () => persistOrdersAndSales(
    persistenceInput(fake, { orders: [order()] }),
  ))

  const sale = fake.rows("commercial_alert_events").find((row) =>
    row.event_type === "SALE_DETECTED")
  assert.equal(sale.evidence.notificationDisposition, "HISTORICAL_RECOVERY")
  assert.equal(fake.rows("commercial_alert_events").some((row) =>
    row.evidence?.contractVersion ===
      "SELLER_OS_WHATSAPP_SALE_ALERT_STORAGE_ADAPTER_V1"), false)
  assert.equal(fake.rows("alert_delivery_outbox").length, 0)
})

test("post-cutover retry reserves one WhatsApp outbox after sale persistence", async () => {
  const fake = fakePersistence()
  await withWhatsappConfiguration(false, () => persistOrdersAndSales(
    persistenceInput(fake, { observedAt: "2026-08-13T15:00:00.000Z" }),
  ))
  const saleInput = persistenceInput(fake, {
    orders: [order({
      creationDate: "2026-08-21T04:00:00.000Z",
      lastModifiedDate: "2026-08-21T04:01:00.000Z",
    })],
    observedAt: OBSERVED_AT,
  })
  await withWhatsappConfiguration(false, () => persistOrdersAndSales(saleInput))
  assert.equal(fake.rows("alert_delivery_outbox").length, 0)

  const recovered = await withWhatsappConfiguration(true, () =>
    persistOrdersAndSales({
      ...saleInput,
      observedAt: "2026-08-13T18:00:00.000Z",
    }))
  const duplicate = await withWhatsappConfiguration(true, () =>
    persistOrdersAndSales({
      ...saleInput,
      observedAt: "2026-08-13T19:00:00.000Z",
    }))
  const adapters = fake.rows("commercial_alert_events").filter((row) =>
    row.evidence?.contractVersion ===
      "SELLER_OS_WHATSAPP_SALE_ALERT_STORAGE_ADAPTER_V1")

  assert.equal(recovered.alertsGenerated, 1)
  assert.equal(duplicate.alertsGenerated, 0)
  assert.equal(fake.rows("alert_delivery_outbox").length, 1)
  assert.equal(adapters.length, 1)
  assert.equal(adapters[0].marketplace_line_item_id, "LINE-1")
  assert.match(adapters[0].evidence.canonicalSalesOrderEventId,
    /^commercial-v1:[0-9a-f]{64}$/)
})

test("outbox crash is recovered after SALE_DETECTED without duplicate alert", async () => {
  const fake = fakePersistence({ outboxFailures: 1 })
  await withWhatsappConfiguration(false, () => persistOrdersAndSales(
    persistenceInput(fake, { observedAt: "2026-08-13T15:00:00.000Z" }),
  ))
  const saleInput = persistenceInput(fake, { orders: [order({
    creationDate: "2026-08-21T04:00:00.000Z",
    lastModifiedDate: "2026-08-21T04:01:00.000Z",
  })] })

  await assert.rejects(
    withWhatsappConfiguration(true, () => persistOrdersAndSales(saleInput)),
    /COMMERCIAL_ALERT_ENQUEUE_FAILED/,
  )
  assert.equal(fake.rows("commercial_alert_events").filter((row) =>
    row.evidence?.contractVersion ===
      "SELLER_OS_WHATSAPP_SALE_ALERT_STORAGE_ADAPTER_V1").length, 1)

  const retry = await withWhatsappConfiguration(true, () =>
    persistOrdersAndSales({
      ...saleInput,
      observedAt: "2026-08-13T18:00:00.000Z",
    }))
  assert.equal(retry.alertsGenerated, 1)
  assert.equal(fake.rows("alert_delivery_outbox").length, 1)
  assert.equal(fake.rows("commercial_alert_events").filter((row) =>
    row.evidence?.contractVersion ===
      "SELLER_OS_WHATSAPP_SALE_ALERT_STORAGE_ADAPTER_V1").length, 1)
})

test("multi-line Order reserves one canonical operator WhatsApp per line", async () => {
  const fake = fakePersistence()
  await withWhatsappConfiguration(false, () => persistOrdersAndSales(
    persistenceInput(fake, { observedAt: "2026-08-13T15:00:00.000Z" }),
  ))
  await withWhatsappConfiguration(true, () => persistOrdersAndSales(
    persistenceInput(fake, {
      orders: [order({
        creationDate: "2026-08-21T04:00:00.000Z",
        lastModifiedDate: "2026-08-21T04:01:00.000Z",
        totalAmount: 49.99,
        lineItems: [
          line(),
          line({
            lineItemId: "LINE-2",
            listingId: ITEM_B,
            sku: "IMN-LST-000021",
            title: "Second item",
            quantity: 2,
            lineItemAmount: 20,
          }),
        ],
      })],
    }),
  ))

  assert.equal(fake.rows("alert_delivery_outbox").length, 2)
  assert.equal(fake.rows("commercial_alert_events").filter((row) =>
    row.evidence?.contractVersion ===
      "SELLER_OS_WHATSAPP_SALE_ALERT_STORAGE_ADAPTER_V1").length, 2)
  assert.equal(new Set(fake.rows("alert_delivery_outbox").map((row) =>
    row.deduplication_key)).size, 2)
})

test("fulfilled sale stays in feed evidence without reopening purchase or Luna alert", async () => {
  const fake = fakePersistence()
  await withWhatsappConfiguration(false, () => persistOrdersAndSales(
    persistenceInput(fake, { observedAt: "2026-08-13T15:00:00.000Z" }),
  ))
  const exactListing = listing(ITEM_A, "IMN-LST-000020", {
    market_radar_product_id: "LUNA-PRODUCT-1",
    supplier_variant_id: "LUNA-VARIANT-1",
    supplier_sku: "LUNA-SKU-1",
  })
  const staleSupply = {
    product_id: "LUNA-PRODUCT-1",
    supplier_variant_id: "LUNA-VARIANT-1",
    sku: "LUNA-SKU-1",
    title: "Supplier product",
    variant_title: "Variant",
    price: 12,
    available: true,
    inventory_quantity: 10,
    product_url: "https://lunaportex.com/products/example",
    captured_at: "2026-08-10T12:00:00.000Z",
    barcode: null,
    vendor: "Supplier",
    product_type: "Audio",
    metadata: null,
  }
  await withWhatsappConfiguration(false, () => persistOrdersAndSales(
    persistenceInput(fake, {
      orders: [order({ orderFulfillmentStatus: "FULFILLED" })],
      listings: [exactListing],
      supplies: [staleSupply],
      verifiedIdentities: new Set([`${ITEM_A}:IMN-LST-000020`]),
    }),
  ))

  const eventTypes = fake.rows("commercial_alert_events").map((row) =>
    row.event_type)
  assert.ok(eventTypes.includes("SALE_DETECTED"))
  assert.ok(eventTypes.includes("SALE_TRIGGERED_STOCK_RECHECK"))
  assert.equal(eventTypes.includes("LUNA_SUPPLY_RECHECK_REQUIRED"), false)
  assert.equal(fake.rows("fulfillment_tasks").length, 0)
  assert.equal(fake.rows("alert_delivery_outbox").length, 0)
})

test("sale stock audit never creates a second Luna digest notification", async () => {
  const fake = fakePersistence()
  await withWhatsappConfiguration(false, () => persistOrdersAndSales(
    persistenceInput(fake, { observedAt: "2026-08-13T15:00:00.000Z" }),
  ))
  const exactListing = listing(ITEM_A, "IMN-LST-000020", {
    market_radar_product_id: "LUNA-PRODUCT-1",
    supplier_variant_id: "LUNA-VARIANT-1",
    supplier_sku: "LUNA-SKU-1",
  })
  const staleSupply = {
    product_id: "LUNA-PRODUCT-1",
    supplier_variant_id: "LUNA-VARIANT-1",
    sku: "LUNA-SKU-1",
    title: "Supplier product",
    variant_title: "Variant",
    price: 12,
    available: true,
    inventory_quantity: 10,
    product_url: "https://lunaportex.com/products/example",
    captured_at: "2026-08-10T12:00:00.000Z",
    barcode: null,
    vendor: "Supplier",
    product_type: "Audio",
    metadata: null,
  }
  await withWhatsappConfiguration(true, () => persistOrdersAndSales(
    persistenceInput(fake, {
      orders: [order({
        creationDate: "2026-08-21T04:00:00.000Z",
        lastModifiedDate: "2026-08-21T04:01:00.000Z",
      })],
      listings: [exactListing],
      supplies: [staleSupply],
      verifiedIdentities: new Set([`${ITEM_A}:IMN-LST-000020`]),
    }),
  ))

  assert.equal(fake.rows("alert_delivery_outbox").length, 1)
  assert.equal(fake.rows("alert_delivery_outbox")[0].delivery_class,
    "immediate")
  assert.equal(fake.rows("commercial_alert_events").some((row) =>
    row.event_type === "LUNA_SUPPLY_RECHECK_REQUIRED"), false)
})
