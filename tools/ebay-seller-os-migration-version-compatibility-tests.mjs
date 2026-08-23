import assert from "node:assert/strict"
import test from "node:test"

import {
  preserveSellerOsMigrationVersionIdV1,
  sellerOsMigrationVersionFromFilenameV1,
} from "./ebay-seller-os-migration-version-v1.mjs"

test("Seller OS migration versions accept exact 12 and 14 digit identities", () => {
  const twelveDigit = "202607130700"
  const fourteenDigit = "20260821193830"

  assert.equal(preserveSellerOsMigrationVersionIdV1(twelveDigit), twelveDigit)
  assert.equal(preserveSellerOsMigrationVersionIdV1(fourteenDigit), fourteenDigit)
  assert.equal(
    sellerOsMigrationVersionFromFilenameV1(`${twelveDigit}_historical.sql`),
    twelveDigit,
  )
  assert.equal(
    sellerOsMigrationVersionFromFilenameV1(`${fourteenDigit}_current.sql`),
    fourteenDigit,
  )
})

test("Seller OS migration versions reject every unsupported length and content", () => {
  for (const invalid of [
    "20260713070",
    "2026071307000",
    "202608211938300",
    "20260821ABCD",
  ]) {
    assert.equal(preserveSellerOsMigrationVersionIdV1(invalid), null)
  }
})

test("remote migration identity is preserved without padding or normalization", () => {
  const historicalIdentity = "202607130700"
  const preserved = preserveSellerOsMigrationVersionIdV1(historicalIdentity)

  assert.equal(preserved, historicalIdentity)
  assert.equal(preserved?.length, 12)
  assert.notEqual(preserved, `${historicalIdentity}00`)
})
