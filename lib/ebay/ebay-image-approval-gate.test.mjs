import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import test from "node:test"

import {
  assertStoredSameDayImageSetQaPassed,
  currentAttemptPublicObjects,
} from "./ebay-image-approval-policy.ts"

const passedAsset = () => ({ qa_result: { automaticStatus: "PASSED" } })

test("only exact stored PASSED values can approve an atomic six-image set", () => {
  assert.doesNotThrow(() => assertStoredSameDayImageSetQaPassed(
    Array.from({ length: 6 }, passedAsset),
  ))
  for (const invalid of ["PARTIAL", null, undefined, "passed", "UNKNOWN"]) {
    const assets = Array.from({ length: 6 }, passedAsset)
    assets[5] = invalid === undefined
      ? { qa_result: {} }
      : { qa_result: { automaticStatus: invalid } }
    assert.throws(
      () => assertStoredSameDayImageSetQaPassed(assets),
      /SAME_DAY_IMAGE_SET_QA_NOT_PASSED/,
    )
  }
})

test("storage compensation selects only objects created by the current attempt", () => {
  const currentHash = "a".repeat(64)
  const objects = currentAttemptPublicObjects([
    { published_storage_path: "actor/item/new-1.jpg",
      output_sha256: currentHash, public_object_created: true },
    { published_storage_path: "actor/item/existing-identical.jpg",
      output_sha256: currentHash, public_object_created: false },
    { published_storage_path: "actor/item/untracked.jpg",
      output_sha256: "invalid", public_object_created: true },
  ])
  assert.deepEqual(objects, [{
    path: "actor/item/new-1.jpg",
    sha256: currentHash,
    createdByCurrentAttempt: true,
  }])
})

test("UI, API, SQL and publication gates all fail closed on non-PASSED QA", () => {
  const ui = readFileSync("app/admin/ebay/listing-workspace/page.tsx", "utf8")
  const api = readFileSync("app/api/admin/ebay/images/route.ts", "utf8")
  const migration = readFileSync(
    "supabase/migrations/20260722003000_require_passed_professional_image_qa.sql",
    "utf8",
  )
  const publication = readFileSync(
    "lib/ebay/ebay-same-day-authorized-publication.ts",
    "utf8",
  )
  assert.match(ui,
    /disabled=\{imageBusy \|\| asset\.qa_result\?\.automaticStatus !== "PASSED"\}/)
  assert.match(api,
    /record\(reviewAsset\.qa_result\)\.automaticStatus !== "PASSED"/)
  assert.match(migration,
    /automaticStatus' is distinct from 'PASSED'/)
  assert.match(migration, /for update/)
  assert.match(migration, /before insert or update of status/)
  assert.match(publication, /asset\.automaticQa === "PASSED"/)
})

test("failed RPC compensation is explicit and no eBay write exists in review runtime", () => {
  const runtime = readFileSync(
    "lib/ebay/ebay-same-day-image-package-runtime.ts",
    "utf8",
  )
  assert.match(runtime, /Promise\.allSettled/)
  assert.match(runtime, /PUBLIC_STORAGE_COMPENSATION_FAILED/)
  assert.match(runtime, /public_object_created: !uploaded\.error/)
  assert.match(runtime, /ebayWrites: 0/)
  assert.doesNotMatch(runtime, /publishOffer|createOffer|bulkCreateOffer/)
})
