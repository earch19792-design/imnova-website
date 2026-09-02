import assert from "node:assert/strict"
import test from "node:test"

import { parseEbayListingQualityReportV1 } from
  "./ebay-listing-quality-report-import-v1.ts"
import {
  OwnerQualityReportImportError,
  prepareOwnerListingQualityReportImportV1,
  readOwnerListingQualityReportStatusV1,
} from "./ebay-listing-quality-report-owner-import-v1.ts"

const accountKey = `seller:${"a".repeat(64)}`
const importedBy = "11111111-1111-4111-8111-111111111111"
const liveScope = { scopeId: "current-live:EBAY_US:test",
  observedAt: "2026-09-02T12:00:00.000Z", identityStatus: "CERTIFIED" }
const listings = [
  { listingKey: "live-1", itemId: "123456789012", sku: "SKU-1" },
  { listingKey: "live-2", itemId: "123456789013", sku: "SKU-2" },
]

function snapshot(content) {
  return parseEbayListingQualityReportV1({ format: "CSV",
    fileName: "listing-quality.csv", content,
    importedAt: "2026-09-02T12:00:00.000Z" })
}

function prepare(content, extra = {}) {
  return prepareOwnerListingQualityReportImportV1({ snapshot: snapshot(content),
    accountKey, accountAlias: "seller", importedBy, liveScope, liveListings: listings,
    now: "2026-09-02T14:00:00.000Z", ...extra })
}

const header = "Item ID,SKU,Seller Account,Report Date,Marketplace,Item Specific,Recommendation"

test("owner report keeps only exact CURRENT LIVE rows and deduplicates tasks", () => {
  const result = prepare(`${header}\n123456789012,SKU-1,seller,2026-09-02,EBAY_US,Material,Complete Material\n123456789012,SKU-1,seller,2026-09-02,EBAY_US,Material,Complete Material\n999999999999,OLD,seller,2026-09-02,EBAY_US,Material,Complete Material`, {
    productTruthByItemId: new Map([["123456789012", {
      reference: "APPROVED_EXACT_LISTING_PACKAGE:11111111-1111-4111-8111-111111111111",
      itemSpecifics: { Material: "Aluminum" },
    }]]) })
  assert.equal(result.import.report_row_count, 3)
  assert.equal(result.import.nonlive_rows_excluded, 1)
  assert.equal(result.import.live_listings_covered, 1)
  assert.equal(result.import.signals_imported, 1)
  assert.equal(result.signals[0].proposed_value, "Aluminum")
  assert.equal(result.signals[0].operator_action_required, true)
  assert.equal(result.signals[0].priority_class, "NEEDS_ATTENTION")
  assert.equal(result.guards.duplicateTaskCount, 0)
  assert.equal(result.guards.factInvented, false)
})

test("missing Product Truth never creates a value or an operator action", () => {
  const result = prepare(`${header}\n123456789012,SKU-1,seller,2026-09-02,EBAY_US,Material,Complete Material`)
  assert.equal(result.signals[0].product_truth_supported, false)
  assert.equal(result.signals[0].proposed_value, null)
  assert.equal(result.signals[0].operator_action_required, false)
  assert.equal(result.signals[0].priority_class, "WAIT")
  assert.match(result.signals[0].what_to_do_now,
    /todavía no tenemos información suficiente.*No necesitas hacer nada/)
})

test("account, date, exact Item ID, and SKU mapping fail closed", () => {
  const cases = [
    [`Item ID,SKU,Report Date,Item Specific,Recommendation\n123456789012,SKU-1,2026-09-02,Material,Complete`,
      "QUALITY_REPORT_ACCOUNT_MATCH_UNPROVEN"],
    [`Item ID,SKU,Seller Account,Item Specific,Recommendation\n123456789012,SKU-1,seller,Material,Complete`,
      "QUALITY_REPORT_DATE_UNPROVEN"],
    [`SKU,Seller Account,Report Date,Item Specific,Recommendation\nSKU-1,seller,2026-09-02,Material,Complete`,
      "QUALITY_REPORT_EXACT_ITEM_ID_REQUIRED"],
    [`${header}\n123456789012,WRONG,seller,2026-09-02,EBAY_US,Material,Complete`,
      "QUALITY_REPORT_SKU_MAPPING_MISMATCH"],
  ]
  for (const [content, code] of cases) {
    assert.throws(() => prepare(content), (error) =>
      error instanceof OwnerQualityReportImportError && error.code === code)
  }
})

test("a stale report remains durable but produces no action", () => {
  const content = `${header}\n123456789012,SKU-1,seller,2026-09-01,EBAY_US,Material,Complete Material`
  const result = prepare(content, { productTruthByItemId: new Map([[
    "123456789012", { reference: "APPROVED_EXACT_LISTING_PACKAGE:truth",
      itemSpecifics: { Material: "Aluminum" } }]]) })
  assert.equal(result.import.freshness, "STALE")
  assert.equal(result.signals[0].product_truth_supported, true)
  assert.equal(result.signals[0].operator_action_required, false)
  assert.match(result.signals[0].what_to_do_now, /desactualizado/)
})

function statusClient(data) {
  const query = { select() { return this }, eq() { return this },
    order() { return this }, limit() { return this },
    async maybeSingle() { return { data, error: null } } }
  return { from() { return query } }
}

test("daily owner reminder is missing, stale, and cleared by today's valid import", async () => {
  const common = { imported_at: "2026-09-02T13:00:00.000Z",
    live_listings_covered: 2, signals_imported: 3, signals_actionable: 1,
    signals_need_evidence: 2, nonlive_rows_excluded: 4 }
  const missing = await readOwnerListingQualityReportStatusV1({
    supabase: statusClient(null), accountKey, now: "2026-09-02T14:00:00.000Z" })
  assert.equal(missing.state, "MISSING")
  assert.equal(missing.reminderVisible, true)
  const stale = await readOwnerListingQualityReportStatusV1({
    supabase: statusClient({ ...common, report_date: "2026-09-01" }),
    accountKey, now: "2026-09-02T14:00:00.000Z" })
  assert.equal(stale.state, "STALE")
  assert.equal(stale.reminderVisible, true)
  const current = await readOwnerListingQualityReportStatusV1({
    supabase: statusClient({ ...common, report_date: "2026-09-02" }),
    accountKey, now: "2026-09-02T14:00:00.000Z" })
  assert.equal(current.state, "CURRENT")
  assert.equal(current.reminderVisible, false)
  assert.equal(current.nonliveRowsExcluded, 4)
})
