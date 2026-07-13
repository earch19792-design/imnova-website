import assert from "node:assert/strict"
import { createHash } from "node:crypto"
import { readFileSync } from "node:fs"
import test from "node:test"

const migrationPath =
  "supabase/migrations/20260713100000_revoke_unsafe_ebay_table_privileges.sql"
const migration = readFileSync(migrationPath, "utf8")

const sellerOsTables = [
  "ebay_active_listing_risk_events",
  "ebay_active_listing_sync_state",
  "ebay_active_listings",
  "ebay_category_learning_adjustments",
  "ebay_command_center_reviews",
  "ebay_draft_only_approvals",
  "ebay_draft_only_execution_ledger",
  "ebay_image_storage_cleanup_attempts",
  "ebay_image_storage_cleanup_jobs",
  "ebay_listing_image_assets",
  "ebay_listing_packages",
  "ebay_listing_performance_snapshots",
  "ebay_luna_best_selling_signals",
  "ebay_luna_opportunity_assessments",
  "ebay_luna_opportunity_queue",
  "ebay_luna_opportunity_queue_events",
  "ebay_luna_scan_runs",
  "ebay_manual_listing_links",
  "ebay_market_listing_observations",
  "ebay_seller_alert_delivery_attempts",
  "ebay_seller_alert_outbox",
  "ebay_seller_automation_runs",
  "ebay_seller_listing_templates",
  "ebay_seller_scan_tasks",
  "ebay_seller_whatsapp_alert_state",
]

const immutableMigrations = new Map([
  ["20260713070000_create_ebay_image_optimization_pipeline.sql", "3b895d427a54f2492014452a439d3c58ca572c2e6175e20c0b79c1942050cc49"],
  ["20260713071000_create_ebay_manual_listing_registration.sql", "69d621b832e00cf2a1862ca44b41b021d26d9ba7a1f7a9c08d21e1cf6a420833"],
  ["20260713072000_create_ebay_post_listing_learning.sql", "a55a0d3a8251b6de5367129232c62eda7a08765d0a1e4d35e9dfed90f44067ef"],
  ["20260713073000_scope_ebay_seller_whatsapp_claims.sql", "9c584bd4a1ccbea6e77ded738fc9f5fc600d9f4807ff9b0bf92a8f398e415ff0"],
  ["20260713074000_harden_ebay_active_listing_sync.sql", "243cca4256a32cda4423a0b641a50607f2078cb99c36eb1591fdac8f99ee964c"],
  ["20260713075000_scope_ebay_listing_images_by_account.sql", "c72bd1f0b77d33b63ccd03c9378a4c258bfbd66d9d8fe44a8c841e6038c34589"],
  ["20260713076000_limit_ebay_reusable_listing_defaults.sql", "3cf5289ed823e79297d7574d79f291769ad82a6b8c2774e1ceda13f9cab56373"],
  ["20260713077000_create_ebay_image_storage_cleanup_reconciliation.sql", "dc5d1c6dcf8626d5068392f9609143e3d309ca0657bd31f4bc0a9b4b675263c7"],
  ["20260713078000_validate_ebay_active_listing_constraints.sql", "35521aec11379f954862e795e764be5a728cc3420735d5aff22a1241a9422b35"],
  ["20260713079000_add_ebay_active_listing_sync_lease.sql", "fe908b46b96afb3de606f12d06390e60a9b02128a9e9b96cf7e10b897ae9030c"],
])

test("ACL migration covers the complete active Seller OS table boundary", () => {
  for (const table of sellerOsTables) assert.match(migration, new RegExp(`'${table}'`))
  assert.equal(new Set(sellerOsTables).size, 25)
})

test("anon and authenticated lose every unsafe direct table privilege", () => {
  assert.match(
    migration,
    /revoke insert, update, delete, truncate, references, trigger, maintain on table public\.%I from anon, authenticated/i,
  )
  for (const privilege of ["INSERT", "UPDATE", "DELETE", "TRUNCATE", "REFERENCES", "TRIGGER", "MAINTAIN"]) {
    assert.match(migration, new RegExp(`'${privilege}'`))
  }
  assert.match(migration, /has_table_privilege\('anon'/)
  assert.match(migration, /has_table_privilege\('authenticated'/)
  assert.match(migration, /SELLER_OS_ACL_UNSAFE_PRIVILEGE/)
})

test("SELECT is fail-closed and retained only behind authenticated RLS policies", () => {
  assert.match(migration, /revoke select on table public\.%I from anon/i)
  assert.match(migration, /revoke select on table public\.%I from authenticated/i)
  assert.match(migration, /and c\.relrowsecurity/)
  assert.match(migration, /from pg_policies p/)
  assert.match(migration, /p\.cmd in \('SELECT', 'ALL'\)/)
  assert.match(migration, /'authenticated' = any \(p\.roles::text\[\]\)/)
  assert.match(migration, /p\.qual like '%is_admin\(\)%'/)
  assert.match(migration, /SELLER_OS_ACL_ADMIN_SELECT_POLICY_MISSING/)
})

test("service_role remains the server-side operational channel", () => {
  assert.match(migration, /has_table_privilege\('service_role'/)
  assert.match(migration, /SELLER_OS_ACL_SERVICE_ROLE_SELECT_REQUIRED/)
  assert.doesNotMatch(migration, /revoke[^;]+from service_role/is)
  assert.doesNotMatch(migration, /grant\s+/i)
})

test("table default privileges are closed for both migration owner roles", () => {
  assert.match(migration, /alter default privileges for role postgres in schema public/i)
  assert.match(migration, /alter default privileges for role supabase_admin in schema public/i)
  assert.equal((migration.match(/revoke all on tables from anon, authenticated/gi) ?? []).length, 2)
  assert.match(migration, /from pg_default_acl d/)
  assert.match(migration, /SELLER_OS_ACL_UNSAFE_TABLE_DEFAULT_PRIVILEGES_REMAIN/)
})

test("ACL migration changes no owners, RLS state, rows or existing grants", () => {
  assert.doesNotMatch(migration, /alter\s+table[^;]+owner\s+to/is)
  assert.doesNotMatch(migration, /disable\s+row\s+level\s+security/i)
  assert.doesNotMatch(migration, /\b(?:insert\s+into|update\s+public\.|delete\s+from|truncate\s+table)\b/i)
  assert.doesNotMatch(migration, /grant\s+/i)
})

test("all previously applied Seller OS migrations remain byte-for-byte immutable", () => {
  for (const [name, expected] of immutableMigrations) {
    const contents = readFileSync(`supabase/migrations/${name}`)
    assert.equal(createHash("sha256").update(contents).digest("hex"), expected, name)
  }
})
