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

test("malformed and active workbook structures fail with explainable reasons", () => {
  assert.throws(() => parseEbayListingQualityReportV1({ format: "XLSX",
    fileName: "quality.xlsx", content: Buffer.from("not-a-workbook").toString("base64") }),
  (error) => error instanceof QualityReportValidationError && error.reason === "WORKBOOK_UNREADABLE")
  assert.throws(() => parseEbayListingQualityReportV1({ format: "XLSX",
    fileName: "quality.xlsx", content: workbookBase64({
      "xl/vbaProject.bin": new Uint8Array([1, 2, 3]),
    }) }), (error) => error instanceof QualityReportValidationError && error.reason === "MALFORMED_WORKBOOK")
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
