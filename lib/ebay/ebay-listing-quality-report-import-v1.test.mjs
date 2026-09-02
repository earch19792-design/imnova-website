import assert from "node:assert/strict"
import test from "node:test"
import { strToU8, zipSync } from "fflate"

import { associateEbayListingQualityReportV1, parseEbayListingQualityReportV1,
  QualityReportValidationError, summarizeEbayListingQualityAssociationsV1,
  toCommercialMonitorQualityArtifactV1 } from "./ebay-listing-quality-report-import-v1.ts"

const csv = "Item ID,SKU,Recommendation Category,Recommendation,Benchmark,Unknown Safe Field\n123456789012,SKU-1,CTR,Improve primary image,12.5,safe"

function workbookBase64(extra = {}) {
  const cell = (reference, value, formula = "") => `<c r="${reference}" t="inlineStr">${formula}<is><t>${value}</t></is></c>`
  const sheet = `<?xml version="1.0" encoding="UTF-8"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>
    <row r="1">${cell("A1", "eBay Listing Quality Report")}</row>
    <row r="3">${cell("A3", "Item ID")}${cell("B3", "Recommendation")}${cell("C3", "Benchmark")}${cell("D3", "Unknown Safe Field")}</row>
    <row r="4">${cell("A4", "123456789012")}${cell("B4", "Improve item specifics")}${cell("C4", "9.5")}${cell("D4", "cached only", "<f>HYPERLINK(&quot;https://example.invalid&quot;)</f>")}</row>
    </sheetData></worksheet>`
  const archive = zipSync({
    "[Content_Types].xml": strToU8("<Types xmlns=\"http://schemas.openxmlformats.org/package/2006/content-types\"/>", true),
    "xl/workbook.xml": strToU8(`<?xml version="1.0"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Listing quality" sheetId="1" r:id="rId1"/></sheets></workbook>`, true),
    "xl/_rels/workbook.xml.rels": strToU8(`<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/></Relationships>`, true),
    "xl/worksheets/sheet1.xml": strToU8(sheet, true),
    ...extra,
  })
  return Buffer.from(archive).toString("base64")
}

function workbookWithSheets(sheets) {
  const cell = (reference, value) => `<c r="${reference}" t="inlineStr"><is><t>${value}</t></is></c>`
  const archive = {
    "[Content_Types].xml": strToU8("<Types xmlns=\"http://schemas.openxmlformats.org/package/2006/content-types\"/>", true),
    "xl/workbook.xml": strToU8(`<?xml version="1.0"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>${sheets.map((sheet, index) => `<sheet name="${sheet.name}" sheetId="${index + 1}" r:id="rId${index + 1}"/>`).join("")}</sheets></workbook>`, true),
    "xl/_rels/workbook.xml.rels": strToU8(`<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${sheets.map((_, index) => `<Relationship Id="rId${index + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${index + 1}.xml"/>`).join("")}</Relationships>`, true),
  }
  for (const [index, sheet] of sheets.entries()) {
    const rows = [
      `<row r="1">${cell("A1", sheet.metadata ?? "eBay Listing Quality Report")}</row>`,
      `<row r="3">${sheet.headers.map((value, column) => cell(`${String.fromCharCode(65 + column)}3`, value)).join("")}</row>`,
      ...sheet.rows.map((values, rowIndex) => `<row r="${rowIndex + 4}">${values.map((value, column) => cell(`${String.fromCharCode(65 + column)}${rowIndex + 4}`, value)).join("")}</row>`),
    ]
    archive[`xl/worksheets/sheet${index + 1}.xml`] = strToU8(`<?xml version="1.0"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>${rows.join("")}</sheetData></worksheet>`, true)
  }
  return Buffer.from(zipSync(archive)).toString("base64")
}

test("Quality Report parser fingerprints provenance and preserves safe unknown fields", () => {
  const snapshot = parseEbayListingQualityReportV1({ format: "CSV", fileName: "quality.csv",
    content: csv, importedAt: "2026-08-11T12:00:00Z" })
  assert.equal(snapshot.source, "EBAY_LISTING_QUALITY_REPORT")
  assert.equal(snapshot.rowCount, 1)
  assert.equal(snapshot.rows[0].unknownFields["Unknown Safe Field"], "safe")
  assert.equal(snapshot.rawFileStored, false)
})

test("Quality Report association is Item ID first, unique SKU only, and never fuzzy", () => {
  const snapshot = parseEbayListingQualityReportV1({ format: "CSV", fileName: "quality.csv",
    content: csv, importedAt: "2026-08-11T12:00:00Z" })
  const associated = associateEbayListingQualityReportV1({ snapshot, listings: [
    { listingKey: "listing-1", itemId: "123456789012", sku: "SKU-1" },
    { listingKey: "listing-2", itemId: "123456789013", sku: "SKU-1" },
  ] })
  assert.equal(associated[0].associationStatus, "MATCHED_ITEM_ID")
  assert.equal(associated[0].fuzzyAssociationUsed, false)
  const skuSnapshot = parseEbayListingQualityReportV1({ format: "CSV", fileName: "quality.csv",
    content: "SKU,Recommendation\nSKU-1,Improve specifics", importedAt: "2026-08-11T12:00:00Z" })
  assert.equal(associateEbayListingQualityReportV1({ snapshot: skuSnapshot, listings: [
    { listingKey: "a", itemId: "123456789012", sku: "SKU-1" },
    { listingKey: "b", itemId: "123456789013", sku: "SKU-1" },
  ] })[0].associationStatus, "AMBIGUOUS")
})

test("real import artifact matches the existing Guidance vs Seller OS input contract", () => {
  const snapshot = parseEbayListingQualityReportV1({ format: "CSV", fileName: "quality.csv",
    content: csv, importedAt: "2026-08-11T12:00:00Z" })
  const artifact = toCommercialMonitorQualityArtifactV1(snapshot)
  assert.equal(artifact.source, "EBAY_LISTING_QUALITY_REPORT")
  assert.equal(artifact.sourceVersion, snapshot.parserVersion)
  assert.equal(artifact.rows[0].itemId, "123456789012")
  assert.equal(artifact.rows[0].recommendationCategory, "CTR")
  assert.equal(artifact.rows[0].recommendationText, "Improve primary image")
})

test("official XLSX structure is discovered without executing formulas", () => {
  const snapshot = parseEbayListingQualityReportV1({ format: "XLSX",
    fileName: "Listing quality report.xlsx", content: workbookBase64(),
    importedAt: "2026-08-12T12:00:00Z" })
  assert.equal(snapshot.workbook.selectedWorksheet, "Listing quality")
  assert.equal(snapshot.workbook.headerRowNumber, 3)
  assert.equal(snapshot.workbook.formulaCellCount, 1)
  assert.equal(snapshot.rows[0].itemId, "123456789012")
  assert.equal(snapshot.rows[0].recommendationText, "Improve item specifics")
  assert.equal(snapshot.rows[0].unknownFields["Unknown Safe Field"], "cached only")
  assert.equal(snapshot.rawFileStored, false)
})

test("multiple real-report-shaped worksheets are ranked with explainable diagnostics", () => {
  const content = workbookWithSheets([
    { name: "Summary", headers: ["SKU", "Recommendation"], rows: [["SKU-1", "Review"]] },
    { name: "Listing recommendations", headers: ["Item ID", "SKU", "Recommendation", "Benchmark", "eBay Category"], rows: [
      ["123456789012", "SKU-1", "Improve title", "8", "Fans"],
      ["123456789013", "SKU-2", "Add specifics", "9", "Fans"],
      ["123456789014", "SKU-3", "Improve image", "7", "Fans"],
    ] },
  ])
  const snapshot = parseEbayListingQualityReportV1({ format: "XLSX",
    fileName: "Listing quality report.xlsx", content })
  assert.equal(snapshot.workbook.sheetResolutionState, "AUTO_SELECTED")
  assert.equal(snapshot.workbook.selectedWorksheet, "Listing recommendations")
  assert.equal(snapshot.workbook.candidateSheets.length, 2)
  assert.ok(snapshot.workbook.candidateSheets[0].confidence >
    snapshot.workbook.candidateSheets[1].confidence)
  assert.ok(snapshot.workbook.candidateSheets[0].recognizedKeyColumns.includes("ITEM_ID"))
})

test("ambiguous worksheet tie requires bounded human selection and then continues association", () => {
  const content = workbookWithSheets([
    { name: "US", headers: ["Item ID", "Recommendation", "Benchmark"],
      rows: [["123456789012", "Improve title", "8"]] },
    { name: "Other", headers: ["Item ID", "Recommendation", "Benchmark"],
      rows: [["123456789013", "Improve image", "9"]] },
  ])
  assert.throws(() => parseEbayListingQualityReportV1({ format: "XLSX",
    fileName: "quality.xlsx", content }), (error) => {
    assert.ok(error instanceof QualityReportValidationError)
    assert.equal(error.reason, "HUMAN_SELECTION_REQUIRED")
    assert.equal(error.diagnosis.sheetResolutionState, "HUMAN_SELECTION_REQUIRED")
    assert.equal(error.diagnosis.candidateSheets.length, 2)
    return true
  })
  const selected = parseEbayListingQualityReportV1({ format: "XLSX",
    fileName: "quality.xlsx", content, selectedWorksheet: "US" })
  assert.equal(selected.workbook.selectionMethod, "HUMAN_SELECTED")
  assert.equal(selected.rows[0].itemId, "123456789012")
})

test("XLSX cell content cannot smuggle secrets or buyer PII through base64 transport", () => {
  const content = workbookWithSheets([{ name: "Report",
    headers: ["Item ID", "Recommendation", "Notes"],
    rows: [["123456789012", "Improve title", "buyer@example.com"]] }])
  assert.throws(() => parseEbayListingQualityReportV1({ format: "XLSX",
    fileName: "quality.xlsx", content, selectedWorksheet: "Report" }),
  /QUALITY_REPORT_SECRET_OR_PII_REJECTED/)

  const hiddenSensitiveSheet = workbookWithSheets([
    { name: "Report", headers: ["Item ID", "Recommendation", "Benchmark"],
      rows: [["123456789012", "Improve title", "8"],
        ["123456789013", "Improve image", "9"]] },
    { name: "Notes", headers: ["Note"], rows: [["buyer@example.com"]] },
  ])
  assert.throws(() => parseEbayListingQualityReportV1({ format: "XLSX",
    fileName: "quality.xlsx", content: hiddenSensitiveSheet }),
  /QUALITY_REPORT_SECRET_OR_PII_REJECTED/)
})

test("malformed and active workbook structures fail with explainable reasons", () => {
  assert.throws(() => parseEbayListingQualityReportV1({ format: "XLSX",
    fileName: "quality.xlsx", content: Buffer.from("not-a-workbook").toString("base64") }),
  (error) => error instanceof QualityReportValidationError && error.reason === "WORKBOOK_UNREADABLE")
  assert.throws(() => parseEbayListingQualityReportV1({ format: "XLSX",
    fileName: "quality.xlsx", content: workbookBase64({
      "xl/vbaProject.bin": new Uint8Array([1, 2, 3]),
    }) }), (error) => error instanceof QualityReportValidationError && error.reason === "MALFORMED_WORKBOOK")
})

test("Google Shopping schema is discovered without a fixed worksheet name", () => {
  const content = workbookWithSheets([{ name: "Feed eligibility details",
    headers: ["Item ID", "Custom label", "Google Shopping rejections"],
    rows: [["123456789012", "SKU-1", "Missing identifier"]] }])
  const snapshot = parseEbayListingQualityReportV1({ format: "XLSX",
    fileName: "listing-quality-report.xlsx", content })
  assert.equal(snapshot.workbook.selectionMethod, "SCHEMA_MULTI_SHEET")
  assert.deepEqual(snapshot.workbook.recognizedWorksheets,
    ["Feed eligibility details"])
  assert.equal(snapshot.rows[0].googleShoppingRejections, "Missing identifier")
})

test("real eBay schema parses every category sheet and skips Summary Guide and unsupported sheets", () => {
  const headers = ["Item Id", "Item title", "Custom label",
    "Recommended item specifics to add", "Number of photos",
    "Promoted listings", "Google Shopping rejections",
    "Daily impressions per listing", "Click-through rate",
    "Sales conversion rate", "UPC", "EAN"]
  const content = workbookWithSheets([
    { name: "Summary", headers: ["Report date", "2026-09-02"],
      rows: [["Seller account", "seller"]] },
    { name: "Guide", headers: ["Instructions"], rows: [["Read only"]] },
    { name: "Future category A", headers, rows: [["123456789012", "Safe item A",
      "SKU-1", "Material", "1", "No", "None", "120", "2.5%", "1.2%",
      "123456789012", "1234567890123"]] },
    { name: "Future category B", headers, rows: [
      ["123456789013", "Safe item B", "SKU-2", "Color", "4", "Yes",
        "Missing identifier", "80", "1.5%", "0.8%", "", ""],
      ["999999999999", "Historical item", "OLD", "Brand", "2", "Yes",
        "None", "4", "0", "0", "", ""],
      ["123456789012", "Safe item A", "SKU-1", "Material", "1", "No",
        "None", "120", "2.5%", "1.2%", "123456789012", "1234567890123"],
    ] },
    { name: "Feed state", headers: ["Item Id", "Google Shopping rejections"],
      rows: [["123456789013", "Missing identifier"]] },
    { name: "Unrelated export", headers: ["Record", "Value"], rows: [["1", "safe"]] },
  ])
  const snapshot = parseEbayListingQualityReportV1({ format: "XLSX",
    fileName: "listing-quality-report.xlsx", content })
  assert.equal(snapshot.workbook.selectionMethod, "SCHEMA_MULTI_SHEET")
  assert.equal(snapshot.workbook.recognizedSheetCount, 3)
  assert.deepEqual(new Set(snapshot.workbook.recognizedWorksheets), new Set([
    "Future category A", "Future category B", "Feed state"]))
  assert.equal(snapshot.rowCount, 5)
  assert.ok(snapshot.rows.every((row) =>
    !["Summary", "Guide", "Unrelated export"].includes(row.sourceSheetName)))
  const itemA = snapshot.rows.find((row) => row.itemId === "123456789012")
  assert.equal(itemA.reportDate, "2026-09-02")
  assert.equal(itemA.reportAccount, "seller")
  assert.equal(itemA.dailyImpressionsPerListing, 120)
  assert.equal(itemA.clickThroughRate, 2.5)
  assert.equal(itemA.salesConversionRate, 1.2)
  assert.equal(itemA.upc, "123456789012")
  assert.equal(itemA.ean, "1234567890123")
  assert.equal(snapshot.rawFileStored, false)
})

test("association aggregate is a complete authoritative partition", () => {
  const snapshot = parseEbayListingQualityReportV1({ format: "XLSX",
    fileName: "quality.xlsx", content: workbookBase64() })
  const rows = associateEbayListingQualityReportV1({ snapshot, listings: [
    { listingKey: "listing-1", itemId: "123456789012", sku: "SKU-1" },
  ] })
  assert.deepEqual(summarizeEbayListingQualityAssociationsV1(rows), {
    reportRows: 1, matchedItemId: 1, matchedUniqueSku: 0, unresolved: 0,
    ambiguous: 0, partitionValid: true,
  })
})

test("incompatible files and buyer PII fail closed", () => {
  assert.throws(() => parseEbayListingQualityReportV1({ format: "CSV", fileName: "x.csv",
    content: "Random,Other\na,b" }), (error) =>
    error instanceof QualityReportValidationError && error.reason === "LISTING_IDENTITY_UNPROVEN")
  assert.throws(() => parseEbayListingQualityReportV1({ format: "CSV", fileName: "x.csv",
    content: "Item ID,Buyer Email,Recommendation\n123456789012,a@example.com,Fix" }),
  /QUALITY_REPORT_SECRET_OR_PII_REJECTED|QUALITY_REPORT_BUYER_PII_HEADER_REJECTED/)
})
