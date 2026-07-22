import assert from "node:assert/strict"
import test from "node:test"
import { readFileSync } from "node:fs"

import {
  orderReferenceGuidedAssetsForEbay,
  REFERENCE_GUIDED_SECONDARY_JOB_ROLE,
  REFERENCE_GUIDED_SEVEN_ASSET_ROLES,
} from "./reference-guided-seven-asset-contract.ts"

test("primary main is always first and secondary one remains distinct", () => {
  const shuffled = [...REFERENCE_GUIDED_SEVEN_ASSET_ROLES].reverse().map((role) => ({
    role,
    url: `https://private.example/${role}.png`,
  }))
  const ordered = orderReferenceGuidedAssetsForEbay(shuffled)
  assert.match(ordered[0], /PRIMARY_MAIN/)
  assert.match(ordered[1], /SECONDARY_MATERIAL_DETAIL/)
  assert.equal(REFERENCE_GUIDED_SECONDARY_JOB_ROLE[1],
    "SECONDARY_MATERIAL_DETAIL")
})

test("missing or duplicate roles fail closed before eBay", () => {
  const invalid = REFERENCE_GUIDED_SEVEN_ASSET_ROLES.map((role) => ({
    role, url: `https://private.example/${role}.png`,
  }))
  invalid[1] = invalid[0]
  assert.throws(() => orderReferenceGuidedAssetsForEbay(invalid),
    /REFERENCE_GUIDED_SEVEN_ASSET_CONTRACT_INVALID/)
})

test("the authorized publication path enforces contract order before eBay", () => {
  const publication = readFileSync(new URL(
    "./ebay-same-day-authorized-publication.ts", import.meta.url), "utf8")
  assert.match(publication, /orderReferenceGuidedAssetsForEbay/)
  assert.match(publication,
    /requireReferenceGuidedContract && !referenceGuidedContractPresent/)
  assert.match(publication,
    /VISUAL_STRATEGY_V3[\s\S]*REFERENCE_GUIDED_PRODUCT_GENERATION_V1/)
  assert.match(publication, /ordered\.every\(\(url, index\) => imageUrls\[index\] === url\)/)
  assert.match(publication, /imageUrls\.every\(\(url, index\) => manifestUrls\[index\] === url\)/)
})

test("persistence stores ordinal zero separately from the six job-backed secondaries", () => {
  const migration = readFileSync(new URL(
    "../../supabase/migrations/20260722024000_reference_guided_human_rejection_and_deterministic_crop.sql",
    import.meta.url), "utf8")
  assert.match(migration, /ebay_reference_guided_asset_contract_slots/)
  assert.match(migration,
    /asset_ordinal = 0 and asset_role = 'PRIMARY_MAIN'/)
  assert.match(migration,
    /asset_ordinal = 1 and asset_role = 'SECONDARY_MATERIAL_DETAIL'/)
  assert.match(migration, /REFERENCE_GUIDED_SEVEN_ASSET_CONTRACT_PERSISTENCE_FAILED/)
})
