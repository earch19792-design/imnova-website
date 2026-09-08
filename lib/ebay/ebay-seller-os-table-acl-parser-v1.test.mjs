import assert from "node:assert/strict"
import test from "node:test"
import { hasExplicitSellerOsTableRevokeV1 as revoked } from "../../tools/seller-os-table-acl-v1.mjs"

test("ACL guard recognizes both members of explicit multi-table revocation", () => {
  const sql = "revoke all on table public.ebay_one,\n public.ebay_two from public, anon, authenticated;"
  assert.equal(revoked(sql, "ebay_one"), true)
  assert.equal(revoked(sql, "ebay_two"), true)
  assert.equal(revoked(sql, "ebay_on"), false)
})
test("ACL guard rejects missing roles, unrelated tables and commented/quoted revokes", () => {
  for (const sql of ["revoke all on table public.ebay_one from anon;",
    "revoke all on table public.ebay_other from anon, authenticated;",
    "-- revoke all on table public.ebay_one from anon, authenticated;",
    "select 'revoke all on table public.ebay_one from anon, authenticated;';",
    "/* revoke all on table public.ebay_one from anon, authenticated; */"]) {
    assert.equal(revoked(sql, "ebay_one"), false)
  }
})
