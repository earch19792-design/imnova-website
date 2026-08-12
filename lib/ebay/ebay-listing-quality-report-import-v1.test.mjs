import assert from "node:assert/strict"
import test from "node:test"

import { associateEbayListingQualityReportV1, parseEbayListingQualityReportV1,
  toCommercialMonitorQualityArtifactV1 } from "./ebay-listing-quality-report-import-v1.ts"

const csv = "Item ID,SKU,Recommendation Category,Recommendation,Benchmark,Unknown Safe Field\n123456789012,SKU-1,CTR,Improve primary image,12.5,safe"

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

test("incompatible files and buyer PII fail closed", () => {
  assert.throws(() => parseEbayListingQualityReportV1({ format: "CSV", fileName: "x.csv",
    content: "Random,Other\na,b" }), /QUALITY_REPORT_REQUIRED_STRUCTURE_MISSING/)
  assert.throws(() => parseEbayListingQualityReportV1({ format: "CSV", fileName: "x.csv",
    content: "Item ID,Buyer Email,Recommendation\n123456789012,a@example.com,Fix" }),
  /QUALITY_REPORT_SECRET_OR_PII_REJECTED|QUALITY_REPORT_BUYER_PII_HEADER_REJECTED/)
})
