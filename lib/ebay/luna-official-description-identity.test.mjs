import assert from "node:assert/strict"
import test from "node:test"

import { extractLunaOfficialDescriptionIdentity } from "./luna-official-description-identity.ts"

test("extracts explicit Brand and Model labels from an official Luna description", () => {
  const result = extractLunaOfficialDescriptionIdentity({
    bodyHtml: `<p><strong>Brand:</strong> Rust-Oleum</p><p>Model Number: 376900</p><p>Size: 12 oz</p>`,
    nativePackCount: 1,
  })
  assert.equal(result.readyForExactResearchQuery, true)
  assert.deepEqual(result.facts, {
    brand: "Rust-Oleum", gtin: null, mpn: null, model: "376900",
    packCount: 1, size: "12 oz",
  })
  assert.equal(result.rawHtmlStored, false)
  assert.equal(result.rawTextStored, false)
  assert.match(result.evidenceHash ?? "", /^sha256:[0-9a-f]{64}$/)
})

test("Brand new and prose mentioning models are never mistaken for labels", () => {
  const result = extractLunaOfficialDescriptionIdentity({
    bodyHtml: `<p>Brand new with tags. Compatible with several models.</p>`,
  })
  assert.equal(result.readyForExactResearchQuery, false)
  assert.equal(result.facts.brand, null)
  assert.equal(result.facts.model, null)
  assert.equal(result.facts.packCount, null)
})

test("unknown Luna pack remains null and is never inferred as a single unit", () => {
  const unknown = extractLunaOfficialDescriptionIdentity({
    bodyHtml: `<p>Brand: Acme</p><p>Model: M-100</p>`,
  })
  assert.equal(unknown.facts.packCount, null)
  assert.equal(unknown.readyForExactResearchQuery, false)
  assert.ok(unknown.blockers.includes("LUNA_DESCRIPTION_PACK_IDENTITY_MISSING"))

  const explicit = extractLunaOfficialDescriptionIdentity({
    bodyHtml: `<p>Brand: Acme</p><p>Model: M-100</p><p>Pack count: 6</p>`,
  })
  assert.equal(explicit.facts.packCount, 6)
})

test("validates GTIN checksum and does not accept an invalid identifier", () => {
  const valid = extractLunaOfficialDescriptionIdentity({
    bodyHtml: `<p>UPC: 036000291452</p>`,
    nativePackCount: 1,
  })
  assert.equal(valid.facts.gtin, "036000291452")
  assert.equal(valid.readyForExactResearchQuery, true)

  const invalid = extractLunaOfficialDescriptionIdentity({
    bodyHtml: `<p>UPC: 036000291453</p>`,
    nativePackCount: 1,
  })
  assert.equal(invalid.facts.gtin, null)
  assert.ok(invalid.blockers.includes("LUNA_DESCRIPTION_GTIN_INVALID"))
})

test("does not return raw HTML or decoded source text", () => {
  const result = extractLunaOfficialDescriptionIdentity({
    bodyHtml: `<div>Brand: RAM Mounts</div><div>Model: RAM-B-111-238U</div>`,
  })
  assert.equal("bodyHtml" in result, false)
  assert.equal("text" in result, false)
  assert.doesNotMatch(JSON.stringify(result), /<div>|rawText":"|rawHtml":"/i)
})
