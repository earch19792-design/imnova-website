import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import test from "node:test"

import {
  buildExactTargetedLunaObservation,
  fetchPublicLunaProductForActiveListingMonitor,
  isRetryablePublicLunaFetchError,
  runTargetedActiveListingLunaMonitor,
  targetedLunaSnapshotMateriallyChanged,
} from "./ebay-targeted-active-listing-luna-monitor.ts"

const productUrl = "https://lunaportex.com/products/example-product"
const routeSource = readFileSync(new URL(
  "../../app/api/cron/ebay-active-listing-luna-monitor/route.ts",
  import.meta.url,
), "utf8")
const leaseMigration = readFileSync(new URL(
  "../../supabase/migrations/20260718049000_serialize_targeted_luna_active_monitor.sql",
  import.meta.url,
), "utf8")
const authenticatedWatcherSource = readFileSync(new URL(
  "./ebay-luna-authenticated-http-watcher-v1.ts",
  import.meta.url,
), "utf8")

function previousSnapshot(overrides = {}) {
  return {
    id: "snapshot-1",
    source_id: "source-1",
    product_id: "product-1",
    supplier_variant_id: "2002",
    variant_title: "Default Title",
    sku: "SKU-EXACT",
    barcode: "012345678905",
    price: 10,
    compare_at_price: 12,
    available: false,
    inventory_quantity: 0,
    collections: ["products", "weekly-deals"],
    discount_percent: 16.67,
    weight: 100,
    weight_unit: "g",
    raw: {},
    captured_at: "2026-07-18T10:00:00.000Z",
    ...overrides,
  }
}

function target(overrides = {}) {
  return {
    marketRadarProductId: "product-1",
    sourceId: "source-1",
    supplierProductId: "1001",
    supplierVariantId: "2002",
    supplierSku: "SKU-EXACT",
    productUrl,
    listingCount: 1,
    previousSnapshot: previousSnapshot(),
    ...overrides,
  }
}

function product(overrides = {}) {
  return {
    productId: "1001",
    handle: "example-product",
    title: "Example Product",
    vendor: "Luna Warehouse",
    productType: "Household",
    canonicalUrl: productUrl,
    imageUrls: [],
    variants: [{
      id: "2002",
      title: "Default Title",
      sku: "SKU-EXACT",
      sourceUnitBarcode: "012345678905",
      sourceUnitPrice: 8,
      sourceCompareAtPrice: 10,
      available: true,
      weight: 100,
      weightUnit: "g",
    }],
    ...overrides,
  }
}

function humanApprovalRawPayload(overrides = {}) {
  return {
    seller_os_luna_watcher_v1: {
      contractVersion: "LUNA_SUPPLIER_STOCK_WATCHER_V1_2026_08_12",
      classification: "EXACT_PROVEN",
      humanApproved: true,
      ebayItemId: "366581876813",
      supplierProductId: "1001",
      supplierVariantId: "2002",
      supplierSku: "SKU-EXACT",
      canonicalSourceUrl: productUrl,
      approvedAt: "2026-07-18T10:05:00.000Z",
      approvalProvenance: "HUMAN_APPROVED_LUNA_ACTIVATION_PREVIEW",
      ...overrides,
    },
  }
}

function fakeSupabase(options = {}) {
  const state = {
    snapshotWrites: [],
    eventWrites: [],
    writeOrder: [],
    accountFilters: [],
  }
  const activeListing = {
    id: "listing-row-1",
    ebay_item_id: "366581876813",
    market_radar_product_id: "product-1",
    supplier_variant_id: "2002",
    supplier_sku: "SKU-EXACT",
    raw_payload: options.activeRawPayload ?? {},
  }
  const currentVariant = {
    product_id: "product-1",
    source_id: "source-1",
    source_key: "lunaportex",
    supplier_product_id: "1001",
    product_url: productUrl,
    snapshot_id: "snapshot-1",
    supplier_variant_id: "2002",
    variant_title: "Default Title",
    sku: "SKU-EXACT",
    barcode: "012345678905",
    price: 10,
    compare_at_price: 12,
    available: true,
    inventory_quantity: null,
    weight: 100,
    weight_unit: "g",
    captured_at: "2026-07-18T10:00:00.000Z",
  }

  class Query {
    constructor(table) {
      this.table = table
      this.operation = "select"
      this.payload = null
    }

    select() { return this }
    order() { return this }
    limit() { return this }
    in() { return this }
    eq(column, value) {
      if (this.table === "ebay_active_listings") state.accountFilters.push([column, value])
      return this
    }
    insert(rows) {
      this.operation = "insert"
      this.payload = rows
      return this
    }
    upsert(rows) {
      this.operation = "upsert"
      this.payload = rows
      return this
    }
    then(resolve, reject) {
      let result
      if (this.table === "ebay_active_listings") {
        result = { data: [activeListing], count: options.activeCount ?? 1, error: null }
      } else if (this.table === "market_radar_latest_variants") {
        result = { data: [currentVariant], error: null }
      } else if (this.table === "market_radar_snapshots" && this.operation === "select") {
        result = { data: [previousSnapshot({ available: true, inventory_quantity: null })], error: null }
      } else if (this.table === "market_radar_snapshots" && this.operation === "insert") {
        state.writeOrder.push("snapshots")
        state.snapshotWrites.push(...this.payload)
        result = { data: this.payload.map((_, index) => ({ id: `new-snapshot-${index}` })), error: null }
      } else if (this.table === "market_radar_events" && this.operation === "upsert") {
        state.writeOrder.push("events")
        if (options.eventWriteFails) {
          result = { data: null, error: { code: "TEST_EVENT_WRITE_FAILED" } }
        } else {
          state.eventWrites.push(...this.payload)
          result = { data: this.payload.map((_, index) => ({ id: `event-${index}` })), error: null }
        }
      } else {
        result = { data: [], error: null }
      }
      return Promise.resolve(result).then(resolve, reject)
    }
  }

  return {
    state,
    client: { from: (table) => new Query(table) },
  }
}

function publicPayload(overrides = {}) {
  return {
    id: 1001,
    handle: "example-product",
    title: "Example Product",
    vendor: "Luna Warehouse",
    type: "Household",
    variants: [{
      id: 2002,
      title: "Default Title",
      sku: "SKU-EXACT",
      barcode: "012345678905",
      price: 1200,
      compare_at_price: 1400,
      available: false,
      weight: 100,
      weight_unit: "g",
    }],
    ...overrides,
  }
}

test("the active-listing reader uses only an unauthenticated public Luna GET", async () => {
  let calls = 0
  const fetched = await fetchPublicLunaProductForActiveListingMonitor(productUrl, {
    fetchImpl: async (url, options) => {
      calls += 1
      assert.equal(url, `${productUrl}.js`)
      assert.equal(options.method, "GET")
      assert.equal(options.redirect, "manual")
      assert.equal(options.credentials, "omit")
      assert.equal(new Headers(options.headers).has("cookie"), false)
      assert.equal(new Headers(options.headers).has("authorization"), false)
      assert.ok(options.signal instanceof AbortSignal)
      return new Response(JSON.stringify({
        id: 1001,
        handle: "example-product",
        title: "Example Product",
        vendor: "Luna Warehouse",
        type: "Household",
        variants: [{
          id: 2002,
          title: "Default Title",
          sku: "SKU-EXACT",
          barcode: "012345678905",
          price: 800,
          compare_at_price: 1000,
          available: true,
          weight: 100,
          weight_unit: "g",
        }],
      }), { status: 200 })
    },
  })
  assert.equal(calls, 1)
  assert.equal(fetched.productId, "1001")
  assert.equal(fetched.variants[0].sourceUnitPrice, 8)
  assert.equal(fetched.variants[0].sourceCompareAtPrice, 10)
})

test("the public Luna reader retries bounded transient 503 responses only", async () => {
  let calls = 0
  const delays = []
  const fetched = await fetchPublicLunaProductForActiveListingMonitor(productUrl, {
    maxAttempts: 3,
    retryBaseDelayMs: 250,
    sleep: async (milliseconds) => {
      delays.push(milliseconds)
    },
    fetchImpl: async () => {
      calls += 1
      return calls < 3
        ? new Response("temporarily unavailable", { status: 503 })
        : new Response(JSON.stringify(publicPayload()), { status: 200 })
    },
  })
  assert.equal(fetched.productId, "1001")
  assert.equal(calls, 3)
  assert.deepEqual(delays, [250, 500])
  assert.equal(
    isRetryablePublicLunaFetchError(
      new Error("LUNA_DIRECTED_IMPORT_FETCH_503"),
    ),
    true,
  )
})

test("the public Luna reader does not retry a provider rate limit", async () => {
  let calls = 0
  await assert.rejects(
    fetchPublicLunaProductForActiveListingMonitor(productUrl, {
      maxAttempts: 3,
      sleep: async () => {
        assert.fail("429 must be surfaced to the caller for Retry-After")
      },
      fetchImpl: async () => {
        calls += 1
        return new Response("rate limited", { status: 429 })
      },
    }),
    /LUNA_DIRECTED_IMPORT_FETCH_429/,
  )
  assert.equal(calls, 1)
})

test("the public Luna GET accepts a safely encoded Unicode Shopify handle", async () => {
  const handle = "🧽-safe-product"
  const encodedUrl = `https://lunaportex.com/products/${encodeURIComponent(handle)}`
  const fetched = await fetchPublicLunaProductForActiveListingMonitor(encodedUrl, {
    fetchImpl: async (url, options) => {
      assert.equal(url, `${encodedUrl}.js`)
      assert.equal(options.method, "GET")
      assert.equal(new Headers(options.headers).has("authorization"), false)
      return new Response(JSON.stringify(publicPayload({ handle })), { status: 200 })
    },
  })
  assert.equal(fetched.handle, handle)
})

test("an exact public observation appends preserved context and detects restock plus price down", () => {
  const observation = buildExactTargetedLunaObservation({
    target: target(),
    product: product(),
    observedAt: "2026-07-18T10:15:00.000Z",
  })
  assert.equal(observation.snapshot.product_id, "product-1")
  assert.equal(observation.snapshot.supplier_variant_id, "2002")
  assert.equal(observation.snapshot.sku, "SKU-EXACT")
  assert.equal(observation.snapshot.available, true)
  assert.equal(observation.snapshot.inventory_quantity, null)
  assert.deepEqual(observation.snapshot.collections, ["products", "weekly-deals"])
  assert.equal(observation.snapshot.discount_percent, 20)
  assert.deepEqual(
    observation.events.map((event) => event.event_type),
    ["restocked", "price_down"],
  )
  assert.equal(
    observation.snapshot.raw.targeted_active_listing_monitor.credentials_used,
    false,
  )
})

test("a public heartbeat cannot erase a verified weight unit when the exact weight is unchanged", () => {
  const observation = buildExactTargetedLunaObservation({
    target: target(),
    product: product({
      variants: [{
        ...product().variants[0],
        weightUnit: null,
      }],
    }),
    observedAt: "2026-07-18T10:15:00.000Z",
  })
  assert.equal(observation.snapshot.weight, 100)
  assert.equal(observation.snapshot.weight_unit, "g")
  assert.equal(
    observation.snapshot.raw.targeted_active_listing_monitor
      .weight_unit_retained_from_previous_exact_snapshot,
    true,
  )
})

test("event idempotency follows the prior snapshot instead of retry wall-clock time", () => {
  const first = buildExactTargetedLunaObservation({
    target: target(),
    product: product(),
    observedAt: "2026-07-18T10:15:00.000Z",
  })
  const retry = buildExactTargetedLunaObservation({
    target: target(),
    product: product(),
    observedAt: "2026-07-18T10:20:00.000Z",
  })
  assert.deepEqual(
    first.events.map((event) => event.idempotency_key),
    retry.events.map((event) => event.idempotency_key),
  )
})

test("an unchanged public heartbeat does not require another market snapshot", () => {
  const stablePrevious = previousSnapshot({
    price: 8,
    compare_at_price: 10,
    available: true,
    inventory_quantity: null,
  })
  const observation = buildExactTargetedLunaObservation({
    target: target({ previousSnapshot: stablePrevious }),
    product: product(),
    observedAt: "2026-07-18T10:15:00.000Z",
  })
  assert.equal(observation.snapshotRequired, false)
  assert.equal(
    targetedLunaSnapshotMateriallyChanged(stablePrevious, observation.snapshot),
    false,
  )
  assert.equal(observation.events.length, 0)
})

test("one public unavailable observation remains a signal while price evidence can advance", () => {
  const observation = buildExactTargetedLunaObservation({
    target: target({
      previousSnapshot: previousSnapshot({
        available: true,
        inventory_quantity: null,
        price: 7,
      }),
    }),
    product: product({
      variants: [{
        ...product().variants[0],
        sourceUnitPrice: 8,
        available: false,
      }],
    }),
    observedAt: "2026-07-18T10:15:00.000Z",
  })
  assert.equal(observation.snapshot.available, null)
  assert.equal(observation.snapshot.inventory_quantity, null)
  assert.equal(
    observation.snapshot.raw.targeted_active_listing_monitor.stock_state,
    "OUT_OF_STOCK_SIGNAL",
  )
  assert.deepEqual(
    observation.events.map((event) => event.event_type),
    ["price_up"],
  )
})

test("two consistent public unavailable observations are required before an out-of-stock event", () => {
  const observation = buildExactTargetedLunaObservation({
    target: target({
      previousSnapshot: previousSnapshot({
        available: null,
        inventory_quantity: null,
        price: 8,
        raw: { targeted_active_listing_monitor: {
          public_out_of_stock_confirmation_count: 1,
        } },
      }),
    }),
    product: product({ variants: [{ ...product().variants[0], available: false }] }),
    observedAt: "2026-07-18T10:15:00.000Z",
  })
  assert.equal(observation.snapshot.available, false)
  assert.equal(observation.snapshot.inventory_quantity, 0)
  assert.equal(
    observation.snapshot.raw.targeted_active_listing_monitor.stock_state,
    "OUT_OF_STOCK_CONFIRMED",
  )
  assert.deepEqual(observation.events.map((event) => event.event_type), ["out_of_stock"])
})

test("authenticated browser evidence preserves quantity and confirms zero twice", () => {
  const inStock = buildExactTargetedLunaObservation({
    target: target({ previousSnapshot: previousSnapshot({ available: true,
      inventory_quantity: null, price: 8 }) }),
    product: product({
      sourceMode: "AUTHENTICATED_WEB_SESSION",
      sourceSessionHealth: "SESSION_OK",
      sourceParserVersion: "LUNA_AUTHENTICATED_HTTP_PRODUCT_V1",
      sourceEvidenceFingerprint: "luna_authenticated_abc123",
      sourceCurrency: "USD",
      variants: [{ ...product().variants[0], sourceInventoryQuantity: 2,
        sourceInventoryQuantityExplicit: true }],
    }),
    observedAt: "2026-07-18T10:15:00.000Z",
  })
  assert.equal(inStock.snapshot.available, true)
  assert.equal(inStock.snapshot.inventory_quantity, 2)
  assert.equal(inStock.snapshot.raw.inventory_context.inventory_scope,
    "explicit_variant_quantity")
  assert.equal(inStock.snapshot.raw.targeted_active_listing_monitor.source_mode,
    "AUTHENTICATED_WEB_SESSION")
  assert.equal(inStock.snapshot.raw.targeted_active_listing_monitor.credentials_used, true)
  assert.equal(inStock.snapshot.raw.targeted_active_listing_monitor.credential_value_exposed,
    false)

  const zero = buildExactTargetedLunaObservation({
    target: target({ previousSnapshot: previousSnapshot({ available: true,
      inventory_quantity: 2, price: 8 }) }),
    product: product({
      sourceMode: "AUTHENTICATED_WEB_SESSION",
      sourceSessionHealth: "SESSION_OK",
      variants: [{ ...product().variants[0], available: false,
        sourceInventoryQuantity: 0, sourceInventoryQuantityExplicit: true }],
    }),
    observedAt: "2026-07-18T10:15:00.000Z",
  })
  assert.equal(zero.snapshot.available, null)
  assert.equal(zero.snapshot.inventory_quantity, null)
  assert.equal(zero.snapshot.raw.inventory_context.observed_inventory_quantity, 0)
  assert.equal(zero.snapshot.raw.targeted_active_listing_monitor.stock_state,
    "OUT_OF_STOCK_SIGNAL")
  assert.equal(zero.events.some((event) => event.event_type === "out_of_stock"), false)

  const confirmedZero = buildExactTargetedLunaObservation({
    target: target({ previousSnapshot: previousSnapshot({ available: null,
      inventory_quantity: null, price: 8,
      raw: { targeted_active_listing_monitor: {
        public_out_of_stock_confirmation_count: 1,
      } } }) }),
    product: product({
      sourceMode: "AUTHENTICATED_WEB_SESSION",
      sourceSessionHealth: "SESSION_OK",
      variants: [{ ...product().variants[0], available: false,
        sourceInventoryQuantity: 0, sourceInventoryQuantityExplicit: true }],
    }),
    observedAt: "2026-07-18T11:15:00.000Z",
  })
  assert.equal(confirmedZero.snapshot.available, false)
  assert.equal(confirmedZero.snapshot.inventory_quantity, 0)
  assert.equal(confirmedZero.snapshot.raw.targeted_active_listing_monitor.stock_state,
    "OUT_OF_STOCK_CONFIRMED")
  assert.ok(confirmedZero.events.some((event) => event.event_type === "out_of_stock"))
})

test("contradictory authenticated availability and quantity fail closed", () => {
  assert.throws(() => buildExactTargetedLunaObservation({
    target: target(),
    product: product({
      sourceMode: "AUTHENTICATED_WEB_SESSION",
      sourceSessionHealth: "SESSION_OK",
      variants: [{ ...product().variants[0], available: false,
        sourceInventoryQuantity: 4, sourceInventoryQuantityExplicit: true }],
    }),
    observedAt: "2026-07-18T10:15:00.000Z",
  }), /TARGETED_LUNA_AUTHENTICATED_STOCK_CONFLICT/)
})

test("product, variant and SKU mismatches fail closed without an observation", () => {
  for (const mismatchedProduct of [
    product({ productId: "different-product" }),
    product({ variants: [{ ...product().variants[0], id: "different-variant" }] }),
    product({ variants: [{ ...product().variants[0], sku: "sku-exact" }] }),
  ]) {
    assert.throws(() => buildExactTargetedLunaObservation({
      target: target(),
      product: mismatchedProduct,
      observedAt: "2026-07-18T10:15:00.000Z",
    }), /TARGETED_LUNA_IDENTITY_MISMATCH/)
  }
})

test("public authorization failures remain failures and never become out-of-stock evidence", async () => {
  await assert.rejects(
    fetchPublicLunaProductForActiveListingMonitor(productUrl, {
      fetchImpl: async () => new Response("restricted", { status: 403 }),
    }),
    /LUNA_DIRECTED_IMPORT_FETCH_403/,
  )
})

test("the preview service scopes active listings and persists exact snapshots plus events", async () => {
  const originalVercelEnvironment = process.env.VERCEL_ENV
  process.env.VERCEL_ENV = "preview"
  const { client, state } = fakeSupabase()
  try {
    const result = await runTargetedActiveListingLunaMonitor(client, {
      accountKey: "preview-account",
      now: new Date("2026-07-18T10:15:00.000Z"),
      fetchImpl: async () => new Response(JSON.stringify(publicPayload()), { status: 200 }),
    })
    assert.equal(result.status, "complete")
    assert.equal(result.snapshotsInserted, 1)
    assert.equal(result.eventsDetected, 1)
    assert.deepEqual(state.eventWrites.map((event) => event.event_type), ["price_up"])
    assert.equal(state.snapshotWrites[0].available, null)
    assert.deepEqual(state.writeOrder, ["events", "snapshots"])
    assert.ok(state.accountFilters.some(([column, value]) =>
      column === "account_key" && value === "preview-account"))
    assert.equal(result.safety.fullCatalogScanUsed, false)
    assert.equal(result.safety.ebayApiWritesUsed, false)
  } finally {
    if (originalVercelEnvironment === undefined) delete process.env.VERCEL_ENV
    else process.env.VERCEL_ENV = originalVercelEnvironment
  }
})

test("authenticated recapture rejects legacy exact columns without human approval provenance", async () => {
  const originalVercelEnvironment = process.env.VERCEL_ENV
  process.env.VERCEL_ENV = "preview"
  const { client, state } = fakeSupabase()
  let authenticatedReads = 0
  try {
    const result = await runTargetedActiveListingLunaMonitor(client, {
      accountKey: "preview-account",
      productFetcher: async () => {
        authenticatedReads += 1
        return product()
      },
    })
    assert.equal(result.status, "unavailable")
    assert.equal(result.exactTargetsSelected, 0)
    assert.equal(result.unavailable[0].ebayItemId, "366581876813")
    assert.equal(result.unavailable[0].reason,
      "ACTIVE_LISTING_HUMAN_APPROVED_LUNA_LINK_REQUIRED")
    assert.equal(authenticatedReads, 0)
    assert.deepEqual(state.writeOrder, [])
  } finally {
    if (originalVercelEnvironment === undefined) delete process.env.VERCEL_ENV
    else process.env.VERCEL_ENV = originalVercelEnvironment
  }
})

test("authenticated recapture accepts an exact item-bound approval and dedupes the read", async () => {
  const originalVercelEnvironment = process.env.VERCEL_ENV
  process.env.VERCEL_ENV = "preview"
  const { client, state } = fakeSupabase({
    activeRawPayload: humanApprovalRawPayload(),
  })
  let authenticatedReads = 0
  try {
    const result = await runTargetedActiveListingLunaMonitor(client, {
      accountKey: "preview-account",
      productFetcher: async (exactTarget) => {
        authenticatedReads += 1
        assert.equal(exactTarget.supplierProductId, "1001")
        assert.equal(exactTarget.supplierVariantId, "2002")
        assert.equal(exactTarget.supplierSku, "SKU-EXACT")
        return product({
          sourceMode: "AUTHENTICATED_WEB_SESSION",
          sourceSessionHealth: "SESSION_OK",
          sourceParserVersion: "LUNA_AUTHENTICATED_HTTP_PRODUCT_V1",
          sourceEvidenceFingerprint: "luna_authenticated_abc123",
          sourceCurrency: "USD",
          variants: [{ ...product().variants[0], sourceUnitPrice: 10,
            sourceCompareAtPrice: 12 }],
        })
      },
    })
    assert.equal(result.status, "complete")
    assert.equal(result.exactTargetsSelected, 1)
    assert.equal(result.exactTargetsObserved, 1)
    assert.equal(result.supplierProductsFetched, 1)
    assert.equal(authenticatedReads, 1)
    assert.deepEqual(state.writeOrder, [])
  } finally {
    if (originalVercelEnvironment === undefined) delete process.env.VERCEL_ENV
    else process.env.VERCEL_ENV = originalVercelEnvironment
  }
})

test("a portfolio above one batch still makes bounded authenticated progress", async () => {
  const originalVercelEnvironment = process.env.VERCEL_ENV
  process.env.VERCEL_ENV = "preview"
  const { client } = fakeSupabase({
    activeRawPayload: humanApprovalRawPayload(),
    activeCount: 1_000,
  })
  let authenticatedReads = 0
  try {
    const result = await runTargetedActiveListingLunaMonitor(client, {
      accountKey: "preview-account",
      limit: 100,
      productFetcher: async () => {
        authenticatedReads += 1
        return product({ sourceMode: "AUTHENTICATED_WEB_SESSION",
          sourceSessionHealth: "SESSION_OK" })
      },
    })
    assert.equal(result.status, "partial")
    assert.equal(result.totalActiveListingRows, 1_000)
    assert.equal(result.exactTargetsObserved, 1)
    assert.equal(authenticatedReads, 1)
    assert.ok(result.unavailable.some((entry) => entry.reason === "TARGET_LIMIT_REACHED"))
  } finally {
    if (originalVercelEnvironment === undefined) delete process.env.VERCEL_ENV
    else process.env.VERCEL_ENV = originalVercelEnvironment
  }
})

test("a complete unchanged heartbeat writes neither snapshot nor event", async () => {
  const originalVercelEnvironment = process.env.VERCEL_ENV
  process.env.VERCEL_ENV = "preview"
  const { client, state } = fakeSupabase()
  try {
    const result = await runTargetedActiveListingLunaMonitor(client, {
      accountKey: "preview-account",
      now: new Date("2026-07-18T10:15:00.000Z"),
      fetchImpl: async () => new Response(JSON.stringify(publicPayload({
        variants: [{
          id: 2002,
          title: "Default Title",
          sku: "SKU-EXACT",
          barcode: "012345678905",
          price: 1000,
          compare_at_price: 1200,
          available: true,
          weight: 100,
          weight_unit: "g",
        }],
      })), { status: 200 }),
    })
    assert.equal(result.status, "complete")
    assert.equal(result.exactTargetsObserved, 1)
    assert.equal(result.unchangedTargetsObserved, 1)
    assert.equal(result.snapshotsInserted, 0)
    assert.equal(result.eventsInserted, 0)
    assert.deepEqual(state.writeOrder, [])
  } finally {
    if (originalVercelEnvironment === undefined) delete process.env.VERCEL_ENV
    else process.env.VERCEL_ENV = originalVercelEnvironment
  }
})

test("an event write failure cannot advance the current Luna snapshot", async () => {
  const originalVercelEnvironment = process.env.VERCEL_ENV
  process.env.VERCEL_ENV = "preview"
  const { client, state } = fakeSupabase({ eventWriteFails: true })
  try {
    await assert.rejects(
      runTargetedActiveListingLunaMonitor(client, {
        accountKey: "preview-account",
        fetchImpl: async () => new Response(JSON.stringify(publicPayload()), { status: 200 }),
      }),
      /TARGETED_LUNA_EVENT_WRITE_FAILED/,
    )
    assert.deepEqual(state.writeOrder, ["events"])
    assert.equal(state.snapshotWrites.length, 0)
  } finally {
    if (originalVercelEnvironment === undefined) delete process.env.VERCEL_ENV
    else process.env.VERCEL_ENV = originalVercelEnvironment
  }
})

test("an authorization failure is recorded unavailable and performs no snapshot or event write", async () => {
  const originalVercelEnvironment = process.env.VERCEL_ENV
  process.env.VERCEL_ENV = "preview"
  const { client, state } = fakeSupabase()
  try {
    const result = await runTargetedActiveListingLunaMonitor(client, {
      accountKey: "preview-account",
      fetchImpl: async () => new Response("restricted", { status: 403 }),
    })
    assert.equal(result.status, "unavailable")
    assert.equal(result.unavailable[0].reason, "LUNA_PUBLIC_PRODUCT_AUTH_UNAVAILABLE")
    assert.equal(state.snapshotWrites.length, 0)
    assert.equal(state.eventWrites.length, 0)
  } finally {
    if (originalVercelEnvironment === undefined) delete process.env.VERCEL_ENV
    else process.env.VERCEL_ENV = originalVercelEnvironment
  }
})

test("the write service rejects every non-preview environment before database access", async () => {
  const originalVercelEnvironment = process.env.VERCEL_ENV
  process.env.VERCEL_ENV = "production"
  try {
    await assert.rejects(
      runTargetedActiveListingLunaMonitor({
        from: () => { throw new Error("DATABASE_MUST_NOT_BE_TOUCHED") },
      }, { accountKey: "production-account" }),
      /TARGETED_ACTIVE_LISTING_LUNA_MONITOR_PREVIEW_ONLY/,
    )
  } finally {
    if (originalVercelEnvironment === undefined) delete process.env.VERCEL_ENV
    else process.env.VERCEL_ENV = originalVercelEnvironment
  }
})

test("the cron skips legacy auto-linking before the human-approved authenticated read", () => {
  const claimIndex = routeSource.indexOf(
    '"claim_ebay_targeted_luna_monitor_run"',
  )
  const preflightIndex = routeSource.indexOf(
    "const preflightProtection = {",
  )
  const monitorIndex = routeSource.indexOf(
    "const monitor = await runTargetedActiveListingLunaMonitor",
  )
  const postMonitorIndex = routeSource.indexOf(
    "const protection = monitor.status === \"complete\"",
  )
  assert.ok(claimIndex >= 0)
  assert.ok(preflightIndex > claimIndex)
  assert.ok(monitorIndex > preflightIndex)
  assert.ok(postMonitorIndex > monitorIndex)
  assert.match(routeSource.slice(preflightIndex, monitorIndex),
    /automaticSupplierLinksCreated: 0/)
  assert.match(routeSource.slice(preflightIndex, monitorIndex),
    /registryBusinessDataMutations: 0/)
  assert.doesNotMatch(routeSource.slice(preflightIndex, monitorIndex),
    /await reconcileActiveListingProtectionRisks/)
  assert.match(routeSource, /heartbeatAvailable: monitor\.status === "complete"/)
  assert.doesNotMatch(
    routeSource.slice(preflightIndex, monitorIndex),
    /heartbeatAvailable\s*:\s*true/,
  )
})

test("the cron serializes runs and records only a complete pass as a successful heartbeat", () => {
  assert.match(routeSource, /claim_ebay_targeted_luna_monitor_run/)
  assert.match(routeSource, /TARGETED_LUNA_MONITOR_ALREADY_RUNNING/)
  assert.match(routeSource, /status: "already_running"/)
  assert.match(routeSource, /finish_ebay_targeted_luna_monitor_run/)
  assert.match(routeSource, /const leaseSuccess = monitor\.status === "complete"/)
  assert.match(routeSource, /p_success: leaseSuccess/)
  assert.match(routeSource, /heartbeatAvailable: monitor\.status === "complete"/)
})

test("the persistent monitor lease is account scoped and service-role only", () => {
  assert.match(leaseMigration, /targeted_luna_active_lease_expires_at/)
  assert.match(leaseMigration, /on conflict \(account_key\) do update/)
  assert.match(leaseMigration, /targeted_luna_active_lease_expires_at <= now\(\)/)
  assert.match(leaseMigration, /EBAY_TARGETED_LUNA_MONITOR_LEASE_NOT_OWNED/)
  assert.match(
    leaseMigration,
    /revoke all on function public\.claim_ebay_targeted_luna_monitor_run\([\s\S]*?from public, anon, authenticated/,
  )
  assert.match(
    leaseMigration,
    /grant execute on function public\.finish_ebay_targeted_luna_monitor_run\([\s\S]*?to service_role/,
  )
})

test("the cron remains secret-authenticated, feature-gated and Preview-only", () => {
  assert.match(routeSource, /commercialPreviewCronAuthorized\(req\)/)
  assert.match(routeSource, /EBAY_TARGETED_LUNA_ACTIVE_MONITOR_ENABLED/)
  assert.match(routeSource, /process\.env\.VERCEL_ENV !== "preview"/)
  assert.match(routeSource, /stage: "TARGETED_ACTIVE_LISTING_LUNA_MONITOR",\s+accountKey,/)
  assert.match(routeSource, /fetchPublicLunaProductForActiveListingMonitor/)
  assert.doesNotMatch(routeSource, /fetchLunaAuthenticatedBrowserProductV1/)
  assert.match(routeSource, /productFetcher: \(target\) =>/)
  assert.doesNotMatch(routeSource, /LUNAPORTEX_AUTH_COOKIE|EBAY_WRITE|OPENAI_API_KEY/)
})

test("public exact production stock reads do not depend on the protected Luna session", () => {
  const productionBranch = routeSource.slice(
    routeSource.indexOf("if (activation.productionSchedulerEnabled)"),
    routeSource.indexOf("// Protection is evaluated first"),
  )
  assert.match(productionBranch,
    /authority: LUNA_PRODUCTION_STOCK_READ_AUTHORITY/)
  assert.match(productionBranch, /protectedSessionRequired: false/)
  assert.match(productionBranch, /reconcileSellerOsStockIdentityV1/)
  assert.doesNotMatch(productionBranch,
    /protectedSession\.status !== "SESSION_READY"/)
  assert.doesNotMatch(productionBranch,
    /throw new Error\("LUNA_PROTECTED_SESSION_NOT_READY"\)/)
})

test("authenticated Luna readers retain their protected-session gate", () => {
  assert.match(authenticatedWatcherSource,
    /resolveServerOwnedLunaSessionValueV1/)
  assert.match(authenticatedWatcherSource, /LUNA_REAUTH_REQUIRED/)
})
