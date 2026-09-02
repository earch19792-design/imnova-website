import assert from "node:assert/strict"
import fs from "node:fs"
import path from "node:path"
import test from "node:test"

const root = process.cwd()
const read = (value) => fs.readFileSync(path.join(root, value), "utf8")

test("owner import route is owner-only, same-origin, and dedicated-preprod-only", () => {
  const source = read("app/api/admin/ebay/listing-quality-report/route.ts")
  assert.match(source, /validateAdminApiRequest/)
  assert.match(source, /isSameSellerOsAdminOriginV1/)
  assert.match(source, /seller_os_dedicated_preprod/)
  assert.match(source, /prepareOwnerListingQualityReportImportV1/)
  assert.match(source, /persistOwnerQualityReportUploadAttemptV1/)
  assert.match(source, /latestUploadAttempt/)
  assert.doesNotMatch(source, /validateSellerOsApiRequest/)
})

test("owner UI owns upload and reminder while Remote Operator has no upload or raw access", () => {
  const owner = read("app/admin/owner-listing-quality-report-control.tsx")
  const remote = read("app/admin/remote-live-optimization-operator.tsx")
  const home = read("app/admin/page.tsx")
  assert.match(owner, /IMPORTAR LISTING QUALITY REPORT/)
  assert.match(owner, /Listing Quality Report pendiente/)
  assert.match(owner, /Reporte desactualizado · sube uno nuevo/)
  assert.match(owner, /Listing Quality Report actualizado hoy ✓/)
  assert.match(owner, /El último archivo no se pudo importar/)
  assert.match(owner, /El último reporte válido sigue disponible/)
  assert.match(owner, /Último reporte válido/)
  assert.match(owner, /Detalle técnico/)
  assert.match(owner, /data-remote-operator-upload-access="false"/)
  assert.match(owner, /data-remote-operator-raw-report-access="false"/)
  assert.match(home, /OwnerListingQualityReportControl/)
  assert.doesNotMatch(remote, /type="file"/)
  assert.doesNotMatch(remote, /raw_signal_reference|sourceRowFingerprint|unknownFields/)
})

test("scoped migration persists normalized append-only signals with zero marketplace effects", () => {
  const sql = read("supabase/migrations/20260902074741_owner_listing_quality_report_import_v1.sql")
  assert.match(sql, /create table if not exists public\.ebay_listing_quality_report_imports/)
  assert.match(sql, /create table if not exists public\.ebay_listing_quality_report_signals/)
  assert.match(sql, /current_live boolean not null default true/)
  assert.match(sql, /exact_item_id_match boolean not null default true/)
  assert.match(sql, /raw_file_stored boolean not null default false/)
  assert.match(sql, /marketplace_writes integer not null default 0/)
  assert.match(sql, /new_listing_publications integer not null default 0/)
  assert.match(sql, /buyer_messages integer not null default 0/)
  assert.match(sql, /postsale_actions integer not null default 0/)
  assert.match(sql, /before update or delete/)
  assert.match(sql, /force row level security/)
  assert.match(sql, /from anon, authenticated/)

  const attemptSql = read(
    "supabase/migrations/20260902103626_listing_quality_report_upload_attempt_status_parity_v1.sql")
  assert.match(attemptSql,
    /create table if not exists public\.ebay_listing_quality_report_upload_attempts/)
  assert.match(attemptSql,
    /attempt_status in \('FAILED_VALIDATION', 'IMPORTED'\)/)
  assert.match(attemptSql, /raw_file_stored = false/)
  assert.match(attemptSql, /raw_report_exposed_to_remote = false/)
  assert.match(attemptSql, /before update or delete/)
  assert.match(attemptSql, /force row level security/)
  assert.match(attemptSql, /from anon, authenticated/)
  assert.match(attemptSql, /from public/)
})
