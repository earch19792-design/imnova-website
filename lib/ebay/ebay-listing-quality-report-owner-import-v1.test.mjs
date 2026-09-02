import assert from "node:assert/strict"
import test from "node:test"
import { strToU8, zipSync } from "fflate"

import { parseEbayListingQualityReportV1, QualityReportValidationError } from
  "./ebay-listing-quality-report-import-v1.ts"
import {
  OwnerQualityReportImportError,
  prepareFailedOwnerQualityReportUploadAttemptV1,
  prepareOwnerListingQualityReportImportV1,
  prepareSuccessfulOwnerQualityReportUploadAttemptV1,
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

function realWorkbookFixture() {
  const cell = (reference, value) =>
    `<c r="${reference}" t="inlineStr"><is><t>${value}</t></is></c>`
  const column = (index) => String.fromCharCode(65 + index)
  const headers = ["Item Id", "Item title", "Custom label",
    "Recommended item specifics to add", "Number of photos",
    "Promoted listings", "Google Shopping rejections",
    "Daily impressions per listing", "Click-through rate",
    "Sales conversion rate", "UPC", "EAN"]
  const sheets = [
    { name: "Summary", headers: ["Report date", "2026-09-02"],
      rows: [["Seller account", "seller"]] },
    { name: "Guide", headers: ["Instructions"], rows: [["Read only"]] },
    { name: "Category schema one", headers, rows: [
      ["123456789012", "Safe item A", "SKU-1", "Material", "1", "No",
        "None", "120", "2.5%", "1.2%", "123456789012", "1234567890123"],
    ] },
    { name: "Category schema two", headers, rows: [
      ["123456789013", "Safe item B", "SKU-2", "Color", "4", "Yes",
        "Missing identifier", "80", "1.5%", "0.8%", "", ""],
      ["999999999999", "Historical item", "OLD", "Brand", "2", "Yes",
        "None", "4", "0", "0", "", ""],
      ["123456789012", "Safe item A", "SKU-1", "Material", "1", "No",
        "None", "120", "2.5%", "1.2%", "123456789012", "1234567890123"],
    ] },
    { name: "Feed state schema", headers: ["Item Id", "Google Shopping rejections"],
      rows: [["123456789013", "Missing identifier"]] },
    { name: "Unsupported", headers: ["Record", "Value"], rows: [["1", "safe"]] },
  ]
  const archive = {
    "[Content_Types].xml": strToU8("<Types xmlns=\"http://schemas.openxmlformats.org/package/2006/content-types\"/>", true),
    "xl/workbook.xml": strToU8(`<?xml version="1.0"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>${sheets.map((sheet, index) => `<sheet name="${sheet.name}" sheetId="${index + 1}" r:id="rId${index + 1}"/>`).join("")}</sheets></workbook>`, true),
    "xl/_rels/workbook.xml.rels": strToU8(`<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${sheets.map((_, index) => `<Relationship Id="rId${index + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${index + 1}.xml"/>`).join("")}</Relationships>`, true),
  }
  for (const [index, sheet] of sheets.entries()) {
    const rows = [
      `<row r="1">${cell("A1", "eBay Listing Quality Report")}</row>`,
      `<row r="3">${sheet.headers.map((value, columnIndex) =>
        cell(`${column(columnIndex)}3`, value)).join("")}</row>`,
      ...sheet.rows.map((values, rowIndex) => `<row r="${rowIndex + 4}">${values
        .map((value, columnIndex) => cell(`${column(columnIndex)}${rowIndex + 4}`, value))
        .join("")}</row>`),
    ]
    archive[`xl/worksheets/sheet${index + 1}.xml`] = strToU8(
      `<?xml version="1.0"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>${rows.join("")}</sheetData></worksheet>`, true)
  }
  return Buffer.from(zipSync(archive)).toString("base64")
}

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

test("real multi-category workbook normalizes supported signals only after full validation", () => {
  const parsed = parseEbayListingQualityReportV1({ format: "XLSX",
    fileName: "listing-quality-report.xlsx", content: realWorkbookFixture(),
    importedAt: "2026-09-02T12:00:00.000Z" })
  const result = prepareOwnerListingQualityReportImportV1({ snapshot: parsed,
    accountKey, accountAlias: "seller", importedBy, liveScope,
    liveListings: listings, now: "2026-09-02T14:00:00.000Z",
    productTruthByItemId: new Map([
      ["123456789012", { reference: "APPROVED_EXACT_LISTING_PACKAGE:item-a",
        itemSpecifics: { Material: "Aluminum" } }],
      ["123456789013", { reference: "APPROVED_EXACT_LISTING_PACKAGE:item-b",
        itemSpecifics: {} }],
    ]) })
  assert.equal(parsed.workbook.recognizedSheetCount, 3)
  assert.equal(result.import.report_row_count, 5)
  assert.equal(result.import.nonlive_rows_excluded, 1)
  assert.equal(result.import.live_listings_covered, 2)
  assert.equal(result.import.signals_imported, 5)
  assert.equal(result.import.signals_actionable, 2)
  assert.equal(result.guards.duplicateTaskCount, 0)
  assert.equal(result.guards.factInvented, false)
  assert.ok(result.signals.some((row) =>
    row.signal_type === "LISTING_QUALITY_SPECIFIC_RECOMMENDATION" &&
    row.proposed_field === "Material" && row.proposed_value === "Aluminum"))
  assert.ok(result.signals.some((row) =>
    row.signal_type === "VISUAL_COVERAGE_REVIEW" &&
    row.priority_class === "ENRICH"))
  assert.ok(result.signals.some((row) =>
    row.signal_type === "GOOGLE_SHOPPING_REJECTION"))
  const promotion = result.signals.find((row) =>
    row.signal_type === "PROMOTION_VISIBILITY_OPPORTUNITY")
  assert.match(promotion.what_is_happening, /podría recibir más visibilidad/)
  assert.match(promotion.seller_os_recommendation, /aprobación del owner/)
  assert.equal(promotion.operator_action_required, false)
  const missingTruth = result.signals.find((row) =>
    row.proposed_field === null && row.item_id === "123456789013" &&
    row.signal_type === "LISTING_QUALITY_SPECIFIC_RECOMMENDATION")
  assert.match(missingTruth.what_to_do_now,
    /todavía no tenemos información suficiente.*No necesitas hacer nada/)
  const semantics = result.signals.find((row) =>
    row.item_id === "123456789012").source_signal_semantics
  assert.equal(semantics.metrics.dailyImpressionsPerListing, 120)
  assert.equal(semantics.identifierContext.upcPresent, true)
  assert.equal(semantics.identifierContext.eanPresent, true)
  assert.equal(semantics.identifierContext.identifierValuesPersisted, false)
  assert.doesNotMatch(JSON.stringify(semantics), /1234567890123/)
  const attempt = prepareSuccessfulOwnerQualityReportUploadAttemptV1({
    accountKey, attemptedBy: importedBy, format: "XLSX",
    content: realWorkbookFixture(), snapshot: parsed, prepared: result,
    validImportId: "22222222-2222-4222-8222-222222222222",
    attemptedAt: "2026-09-02T15:00:00.000Z", correlationSeed: "real" })
  assert.equal(attempt.recognized_sheet_count, 3)
  assert.deepEqual(new Set(attempt.recognized_sheet_names), new Set([
    "Category schema one", "Category schema two", "Feed state schema"]))
  assert.equal(attempt.rows_parsed, 5)
  assert.equal(attempt.current_live_rows_matched, 4)
})

test("schema-discovered workbook can prove account only through canonical CURRENT LIVE Item IDs", () => {
  const parsed = parseEbayListingQualityReportV1({ format: "XLSX",
    fileName: "listing-quality-report.xlsx", content: realWorkbookFixture(),
    importedAt: "2026-09-02T12:00:00.000Z" })
  const withoutAccountMetadata = { ...parsed,
    rows: parsed.rows.map((row) => ({ ...row, reportAccount: null })) }
  const result = prepareOwnerListingQualityReportImportV1({
    snapshot: withoutAccountMetadata, accountKey, accountAlias: "seller",
    importedBy, liveScope, liveListings: listings,
    now: "2026-09-02T14:00:00.000Z" })
  assert.equal(result.guards.accountMatchAuthority,
    "CANONICAL_CURRENT_LIVE_ITEM_ID")
  assert.equal(result.import.report_account, "seller")
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

test("a failed upload is separate from the last valid import and stores no raw report", () => {
  const error = new QualityReportValidationError("NO_VALID_SHEET", {
    worksheetNames: ["Summary", "Category detail"],
    observedHeaderNames: ["Item ID", "Custom label", "Daily impressions"],
  })
  const attempt = prepareFailedOwnerQualityReportUploadAttemptV1({
    accountKey, attemptedBy: importedBy, format: "XLSX",
    content: Buffer.from("safe-fixture").toString("base64"), error,
    attemptedAt: "2026-09-02T15:00:00.000Z", correlationSeed: "failed" })
  assert.equal(attempt.attempt_status, "FAILED_VALIDATION")
  assert.equal(attempt.safe_failure_code, "REPORT_STRUCTURE_NOT_RECOGNIZED")
  assert.equal(attempt.technical_reason_code, "QUALITY_REPORT_NO_VALID_SHEET")
  assert.deepEqual(attempt.workbook_sheet_names,
    ["Summary", "Category detail"])
  assert.equal(attempt.header_match_status, "NO_VALID_SHEET")
  assert.equal(attempt.valid_import_id, null)
  assert.equal("content" in attempt, false)
})

test("a successful upload outcome binds only to its valid normalized import", () => {
  const parsed = snapshot(`${header}\n123456789012,SKU-1,seller,2026-09-02,EBAY_US,Material,Complete Material`)
  const prepared = prepareOwnerListingQualityReportImportV1({ snapshot: parsed,
    accountKey, accountAlias: "seller", importedBy, liveScope,
    liveListings: listings, now: "2026-09-02T14:00:00.000Z" })
  const attempt = prepareSuccessfulOwnerQualityReportUploadAttemptV1({
    accountKey, attemptedBy: importedBy, format: "CSV",
    content: "safe", snapshot: parsed, prepared,
    validImportId: "22222222-2222-4222-8222-222222222222",
    attemptedAt: "2026-09-02T15:00:00.000Z", correlationSeed: "success" })
  assert.equal(attempt.attempt_status, "IMPORTED")
  assert.equal(attempt.header_match_status, "MATCHED")
  assert.equal(attempt.rows_parsed, 1)
  assert.equal(attempt.current_live_rows_matched, 1)
  assert.equal(attempt.valid_import_id,
    "22222222-2222-4222-8222-222222222222")
  assert.equal("content" in attempt, false)
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
