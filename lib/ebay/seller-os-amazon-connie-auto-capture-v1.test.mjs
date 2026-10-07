import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"
import test from "node:test"

import {
  createAmazonSpApiReadOnlyClientV1,
  getAmazonSpApiReadOnlyConfigurationV1,
  parseAmazonCatalogDemandSignalV1,
  parseAmazonCompetitiveSummaryBatchV1,
  parseAmazonFeeEstimateBatchV1,
  parseAmazonFinanceTransactionsV1,
  parseAmazonListingItemV1,
  parseAmazonSalesTrafficReportV1,
} from "../marketplace/amazon-sp-api-readonly-v1.ts"
import { buildAmazonContributorObservationV1,
  linkAmazonContributorCostAndQuantityV1,
  linkAmazonContributorSupplierCostV1 } from
  "../marketplace/seller-os-amazon-contributor-performance-v1.ts"

test("SP-API configuration is fail closed and never exposes credentials", () => {
  const missing = getAmazonSpApiReadOnlyConfigurationV1({})
  assert.equal(missing.status, "NOT_CONFIGURED")
  assert.deepEqual(missing.missing, ["AMAZON_SP_API_LWA_CLIENT_ID",
    "AMAZON_SP_API_LWA_CLIENT_SECRET", "AMAZON_SP_API_REFRESH_TOKEN",
    "AMAZON_SP_API_SELLER_ID"])
  const environment = { AMAZON_SP_API_LWA_CLIENT_ID: "client",
    AMAZON_SP_API_LWA_CLIENT_SECRET: "super-secret",
    AMAZON_SP_API_REFRESH_TOKEN: "refresh-secret",
    AMAZON_SP_API_SELLER_ID: "A123456789ABCD" }
  const ready = getAmazonSpApiReadOnlyConfigurationV1(environment)
  assert.equal(ready.status, "READY")
  assert.equal(ready.skuPrefix, "CON-")
  assert.equal(JSON.stringify(ready).includes("super-secret"), false)
  assert.equal(JSON.stringify(ready).includes("refresh-secret"), false)
})

test("SP-API client backs off and retries a transient upstream response", async () => {
  let spApiAttempts = 0
  const delays = []
  const fetcher = async (input) => {
    if (String(input) === "https://api.amazon.com/auth/o2/token") {
      return new Response(JSON.stringify({ access_token: "fixture-token",
        expires_in: 3600 }), { status: 200 })
    }
    spApiAttempts += 1
    if (spApiAttempts === 1) {
      return new Response(JSON.stringify({ errors: [{ code: "QuotaExceeded" }] }),
        { status: 429, headers: { "retry-after": "0" } })
    }
    return new Response(JSON.stringify({ processingStatus: "IN_QUEUE" }),
      { status: 200 })
  }
  const client = createAmazonSpApiReadOnlyClientV1({
    environment: { AMAZON_SP_API_LWA_CLIENT_ID: "client",
      AMAZON_SP_API_LWA_CLIENT_SECRET: "secret",
      AMAZON_SP_API_REFRESH_TOKEN: "refresh",
      AMAZON_SP_API_SELLER_ID: "A123456789ABCD" },
    fetcher, sleep: async (milliseconds) => { delays.push(milliseconds) },
    maximumAttempts: 3,
  })
  const result = await client.requestJson("/reports/2021-06-30/reports/fixture")
  assert.equal(result.processingStatus, "IN_QUEUE")
  assert.equal(spApiAttempts, 2)
  assert.deepEqual(delays, [0])
})

test("listing parser captures Amazon facts without inventing missing inventory", () => {
  const listing = parseAmazonListingItemV1({ sku: "CON-BEAUTY-001",
    summaries: [{ asin: "B012345678", itemName: "Fixture serum",
      brand: "Fixture", productType: "BEAUTY", conditionType: "new_new",
      status: ["BUYABLE", "DISCOVERABLE"],
      createdDate: "2026-10-01T00:00:00Z",
      lastUpdatedDate: "2026-10-06T00:00:00Z" }],
    offers: [{ price: { amount: 24.99, currencyCode: "USD" } }],
    fulfillmentAvailability: [] })
  assert.equal(listing?.sellerSku, "CON-BEAUTY-001")
  assert.equal(listing?.state, "ACTIVE")
  assert.equal(listing?.priceUsd, 24.99)
  assert.equal(listing?.availableQuantity, null)
  assert.equal(listing?.fulfillmentChannel, null)
  assert.match(listing?.digest ?? "", /^sha256:[0-9a-f]{64}$/)
})

test("competitive summary captures the conservative delivered Buy Box price", () => {
  const summaries = parseAmazonCompetitiveSummaryBatchV1({ responses: [{
    status: { statusCode: 200 }, body: { asin: "B00IXVMVBY",
      marketplaceId: "ATVPDKIKX0DER", featuredBuyingOptions: [{
        buyingOptionType: "New", segmentedFeaturedOffers: [
          { fulfillmentType: "AFN", listingPrice: { amount: 77.99 },
            shippingOptions: [{ shippingOptionType: "DEFAULT",
              price: { amount: 0 } }] },
          { fulfillmentType: "MFN", listingPrice: { amount: 79 },
            shippingOptions: [{ shippingOptionType: "DEFAULT",
              price: { amount: 2 } }] },
        ],
      }] },
  }] }, { now: new Date("2026-10-07T04:00:00Z") })
  const summary = summaries.get("B00IXVMVBY")
  assert.equal(summary?.state, "AVAILABLE")
  assert.equal(summary?.featuredOfferPriceUsd, 77.99)
  assert.equal(summary?.featuredOfferPriceMaximumUsd, 81)
  assert.equal(summary?.featuredOfferFulfillmentChannel, "FBA")
})

test("catalog rank is demand support but never exact sold units", () => {
  const signal = parseAmazonCatalogDemandSignalV1({ asin: "B00IXVMVBY",
    salesRanks: [{ marketplaceId: "ATVPDKIKX0DER",
      displayGroupRanks: [{ title: "Health & Household", rank: 1250 }],
      classificationRanks: [{ title: "Bladder Control", rank: 8 }] }] },
  { now: new Date("2026-10-07T04:00:00Z") })
  assert.equal(signal?.signalState, "SUPPORTED")
  assert.equal(signal?.displayGroupRank, 1250)
  assert.equal(signal?.classificationRank, 8)
  assert.equal("unitsSold" in (signal ?? {}), false)
})

test("Amazon fee estimate parser does not turn missing fees into zero", () => {
  const parsed = parseAmazonFeeEstimateBatchV1([
    { Status: "Success", FeesEstimateIdentifier: {
      SellerInputIdentifier: "VH-T488-292P", IdValue: "B00IXVMVBY" },
      FeesEstimate: { TimeOfFeesEstimation: "2026-10-07T04:00:00Z",
        TotalFeesEstimate: { CurrencyCode: "USD", Amount: 15.9 } } },
    { Status: "ServiceError", FeesEstimateIdentifier: {
      SellerInputIdentifier: "K2-1255-S9DC", IdValue: "B00DSH3H0W" },
      FeesEstimate: {} },
  ])
  assert.equal(parsed.get("VH-T488-292P")?.totalFeesUsd, 15.9)
  assert.equal(parsed.get("K2-1255-S9DC")?.status, "UNAVAILABLE")
  assert.equal(parsed.get("K2-1255-S9DC")?.totalFeesUsd, null)
})

test("sales and traffic report parses only explicit ASIN metrics", () => {
  const report = parseAmazonSalesTrafficReportV1({
    reportSpecification: { dataStartTime: "2026-09-01T00:00:00Z",
      dataEndTime: "2026-09-28T23:59:59Z" },
    salesAndTrafficByAsin: [{ childAsin: "B012345678",
      sku: "CON-BEAUTY-001", salesByAsin: { unitsOrdered: 12,
        orderedProductSales: { amount: 299.88, currencyCode: "USD" } },
      trafficByAsin: { sessions: 150, pageViews: 190,
        unitSessionPercentage: 8 } }],
  })
  const metric = report.metrics.get("B012345678")
  assert.equal(metric?.unitsOrdered, 12)
  assert.equal(metric?.grossSalesUsd, 299.88)
  assert.equal(metric?.sessions, 150)
  assert.equal(report.metrics.has("B000000000"), false)
})

test("a completed empty sales report stays empty without fabricating zeros", () => {
  const report = parseAmazonSalesTrafficReportV1({
    reportSpecification: { dataStartTime: "2026-09-01T00:00:00Z",
      dataEndTime: "2026-09-28T23:59:59Z" },
    salesAndTrafficByAsin: [],
  })
  assert.equal(report.metrics.size, 0)
  assert.equal(report.dataStartTime, "2026-09-01T00:00:00.000Z")
  assert.equal(report.dataEndTime, "2026-09-28T23:59:59.000Z")
})

test("finance parser aggregates fees by SKU without retaining order identifiers", () => {
  const metrics = parseAmazonFinanceTransactionsV1({ payload: {
    transactions: [{ description: "Order Payment", relatedIdentifiers: [{
      relatedIdentifierName: "ORDER_ID",
      relatedIdentifierValue: "must-not-be-returned" }], items: [{
      contexts: [{ contextType: "ProductContext", sku: "CON-BEAUTY-001",
        asin: "B012345678", quantityShipped: 1 }],
      breakdowns: [
        { breakdownType: "Commission", breakdownAmount: {
          currencyAmount: -3.75, currencyCode: "USD" } },
        { breakdownType: "FBA Fulfillment Fee", breakdownAmount: {
          currencyAmount: -4.2, currencyCode: "USD" } },
      ],
    }] }],
  } })
  const metric = metrics.get("CON-BEAUTY-001")
  assert.equal(metric?.amazonFeesUsd, 3.75)
  assert.equal(metric?.fulfillmentFeesUsd, 4.2)
  assert.equal(JSON.stringify(metric).includes("must-not-be-returned"), false)
})

test("automatic Amazon observation stays fail closed when supplier cost is absent", () => {
  const now = new Date("2026-10-06T20:00:00Z")
  const result = buildAmazonContributorObservationV1({
    observedAt: "2026-10-03T23:59:59Z",
    capture: { mode: "AMAZON_SP_API_READ_ONLY", automated: true,
      authority: "AMAZON_SELLER_CENTRAL" },
    supplier: { name: "Proveedor pendiente de vincular",
      baseUrl: "https://sellercentral.amazon.com",
      sourceKeyOverride: "amazon-connie-unmapped", sku: "CON-BEAUTY-001",
      productId: "B012345678", variantId: "CON-BEAUTY-001",
      evidenceState: "UNPROVEN" },
    product: { title: "Fixture serum", asin: "B012345678" },
    demand: { claim: "HIGH", evidenceState: "CONFIRMED",
      source: "Amazon SP-API GET_SALES_AND_TRAFFIC_REPORT",
      observedAt: "2026-10-03T23:59:59Z" },
    eligibility: { state: "CONFIRMED",
      observedAt: "2026-10-03T00:00:00Z" },
    economics: { unitCostUsd: null, expectedSalePriceUsd: 24.99,
      referralFeePerUnitUsd: null, fbaFeePerUnitUsd: null },
    amazonListing: { state: "ACTIVE", sellerSku: "CON-BEAUTY-001",
      listingPriceUsd: 24.99, availableQuantity: 14,
      listedAt: "2026-10-01T00:00:00Z" },
    performance: { authority: "SELLER_CENTRAL_REPORT",
      observationWindowDays: 28, unitsSold: 12, grossSalesUsd: 299.88,
      amazonFeesUsd: 45, fulfillmentFeesUsd: 50.4, refundsUsd: 0,
      sessions: 150, observedAt: "2026-10-03T23:59:59Z" },
  }, { now })
  assert.equal(result.capture.mode, "AMAZON_SP_API_READ_ONLY")
  assert.equal(result.amazonListing.availableQuantity, 14)
  assert.equal(result.performance.sessions, 150)
  assert.equal(result.performance.actualNetProfitUsd, null)
  assert.equal(result.nextBestEvidence.action, "CAPTURE_DELIVERED_COST")
  assert(result.blockers.includes("DELIVERED_UNIT_COST_UNPROVEN"))
})

test("owner links only supplier and cost while Amazon facts are preserved", () => {
  const now = new Date("2026-10-06T20:00:00Z")
  const automatic = buildAmazonContributorObservationV1({
    observedAt: "2026-10-03T23:59:59Z",
    capture: { mode: "AMAZON_SP_API_READ_ONLY", automated: true },
    supplier: { name: "Proveedor pendiente de vincular",
      baseUrl: "https://sellercentral.amazon.com",
      sourceKeyOverride: "amazon-connie-products",
      sku: "CON-BEAUTY-001", productId: "B012345678",
      variantId: "CON-BEAUTY-001", evidenceState: "UNPROVEN" },
    product: { title: "Fixture serum", asin: "B012345678" },
    demand: { claim: "HIGH", evidenceState: "CONFIRMED",
      source: "Amazon", observedAt: "2026-10-03T23:59:59Z" },
    eligibility: { state: "CONFIRMED",
      observedAt: "2026-10-03T00:00:00Z" },
    economics: { expectedSalePriceUsd: 24.99 },
    amazonListing: { state: "ACTIVE", sellerSku: "CON-BEAUTY-001",
      listingPriceUsd: 24.99, availableQuantity: 14,
      listedAt: "2026-10-01T00:00:00Z" },
    performance: { authority: "SELLER_CENTRAL_REPORT",
      observationWindowDays: 28, unitsSold: 12, grossSalesUsd: 299.88,
      amazonFeesUsd: 45, fulfillmentFeesUsd: 50.4, refundsUsd: 0,
      observedAt: "2026-10-03T23:59:59Z" },
  }, { now })
  const linked = linkAmazonContributorSupplierCostV1({
    existingObservation: automatic, now,
    supplier: { name: "Fixture Wholesale",
      baseUrl: "https://supplier.example.com", sku: "SUP-001",
      productId: "SUP-001", variantId: "SUP-001",
      productUrl: "https://supplier.example.com/SUP-001" },
    economics: { unitCostUsd: 5, inboundShippingPerUnitUsd: 1,
      prepCostPerUnitUsd: 0.5 }, unitsPurchased: 20,
    otherActualCostsUsd: 0,
  })
  assert.equal(linked.supplier.name, "Fixture Wholesale")
  assert.equal(linked.supplier.sourceKey, "amazon-connie-products")
  assert.equal(linked.amazonListing.sellerSku, "CON-BEAUTY-001")
  assert.equal(linked.performance.reportedUnitsSold, 12)
  assert.equal(linked.performance.unitsPurchased, 20)
  assert.equal(linked.performance.actualNetProfitPerUnitUsd, 10.54)
})

test("owner only enters cost and supplier quantity for a discovered proposal", () => {
  const now = new Date("2026-10-07T04:00:00Z")
  const automatic = buildAmazonContributorObservationV1({
    observedAt: now.toISOString(),
    capture: { mode: "AMAZON_SP_API_READ_ONLY", automated: true },
    supplier: { name: "Proveedor pendiente de vincular",
      baseUrl: "https://sellercentral.amazon.com", sourceKeyOverride:
        "amazon-connie-products", sku: "VH-T488-292P",
      productId: "B00IXVMVBY", variantId: "VH-T488-292P",
      evidenceState: "UNPROVEN" },
    product: { title: "Oxytrol 8 Count Pack of 3", asin: "B00IXVMVBY" },
    demand: { claim: "UNKNOWN", evidenceState: "SUPPORTED",
      source: "Amazon Catalog Items salesRanks", observedAt: now.toISOString(),
      displayGroupRank: 1250 },
    eligibility: { state: "CONFIRMED", observedAt: now.toISOString() },
    amazonMarket: { featuredOfferState: "AVAILABLE",
      featuredOfferPriceUsd: 77.99, featuredOfferPriceMaximumUsd: 77.99,
      featuredOfferListingPriceUsd: 77.99, featuredOfferShippingUsd: 0,
      featuredOfferFulfillmentChannel: "FBA", featuredOfferCount: 1,
      observedAt: now.toISOString(), authority: "Amazon Product Pricing" },
    economics: { expectedSalePriceUsd: 77.99,
      estimatedAmazonFeesPerUnitUsd: 15.9,
      feeEstimateState: "AVAILABLE", feeEstimateObservedAt: now.toISOString(),
      feeEstimatePriceUsd: 77.99, feeEstimateFulfillmentChannel: "FBA" },
    amazonListing: { state: "INACTIVE", sellerSku: "VH-T488-292P",
      listingPriceUsd: 76.9, availableQuantity: 0,
      fulfillmentChannel: "FBA", listedAt: now.toISOString() },
    performance: { authority: "UNPROVEN" },
  }, { now })
  const linked = linkAmazonContributorCostAndQuantityV1({
    existingObservation: automatic, unitCostUsd: 30,
    supplierInventoryQuantity: 12, now,
  })
  assert.equal(linked.supplier.name, "Proveedor de Connie")
  assert.equal(linked.supplier.inventoryQuantity, 12)
  assert.equal(linked.economics.unitCostUsd, 30)
  assert.equal(linked.amazonMarket.featuredOfferPriceUsd, 77.99)
  assert.equal(linked.economics.contributionAfterAmazonFeesPerUnitUsd, 32.09)
  assert.equal(linked.economics.maximumAdditionalCostForMinimumProfitUsd, 28.09)
  assert.equal(linked.economics.projectedNetProfitPerUnitUsd, null)
})

test("automatic capture has read-only routes, durable state and a six-hour schedule", async () => {
  const [runtime, schedule, migration, inboxMigration, vercel, page, ownerRoute,
    automaticCapture] = await Promise.all([
    readFile(new URL("../../app/api/cron/amazon-connie-readonly-sync/route.ts",
      import.meta.url), "utf8"),
    readFile(new URL("../../app/api/cron/amazon-connie-readonly-sync-schedule/route.ts",
      import.meta.url), "utf8"),
    readFile(new URL("../../supabase/migrations/20261006233934_seller_os_amazon_connie_automatic_capture_v1.sql",
      import.meta.url), "utf8"),
    readFile(new URL("../../supabase/migrations/20261007040433_amazon_connie_proposal_inbox_buy_box_v1.sql",
      import.meta.url), "utf8"),
    readFile(new URL("../../vercel.json", import.meta.url), "utf8"),
    readFile(new URL("../../app/admin/marketplace/amazon/connie/page.tsx",
      import.meta.url), "utf8"),
    readFile(new URL("../../app/api/admin/marketplace/amazon/collaborators/connie/route.ts",
      import.meta.url), "utf8"),
    readFile(new URL("../marketplace/seller-os-amazon-connie-auto-sync-v1.ts",
      import.meta.url), "utf8"),
  ])
  assert.match(runtime, /CRON_SECRET/)
  assert.match(runtime, /sellerOsPostOnlyGetResponseV1/)
  assert.doesNotMatch(runtime, /putListingsItem|patchListingsItem|deleteListingsItem/)
  assert.match(schedule, /runAmazonConnieReadOnlySync/)
  assert.match(migration, /seller_os_amazon_contributor_sync_state_v1/)
  assert.match(migration, /enable row level security/)
  assert.match(migration, /is not distinct from p_recorded_by_user_id/)
  assert.match(inboxMigration, /RECENT_LISTING_CANDIDATE/)
  assert.match(inboxMigration, /PENDING_REVIEW/)
  assert.match(vercel, /amazon-connie-readonly-sync-schedule/)
  assert.match(vercel, /23 \*\/6 \* \* \*/)
  assert.match(page, /De producto propuesto a decisión de compra/)
  assert.match(page, /Purchase Gate · mínimo \$4 netos/)
  assert.match(page, /Confirmar costo y cantidad · sólo dos datos/)
  assert.match(page, /Buy Box/)
  assert.match(ownerRoute, /CONFIRM_COST_AND_QUANTITY/)
  assert.match(page, /Diagnóstico:/)
  assert.match(page, /WAITING_UPSTREAM/)
  assert.doesNotMatch(page, /Registrar o actualizar un producto/)
  assert.match(ownerRoute, /\(\?:SELLER_OS_AMAZON_\|AMAZON_SP_API_\)/)
  assert.match(automaticCapture, /reportCompleted/)
  assert.match(automaticCapture, /ignoredSellerSkus/)
  assert.doesNotMatch(automaticCapture, /run_status: sales\.size > 0/)
})
