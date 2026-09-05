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
  assert.match(source, /VERCEL_DEPLOYMENT_ID/)
  assert.match(source, /mimeType/)
  assert.match(source, /failedStage: "IMPORT_RPC"/)
  assert.doesNotMatch(source, /validateSellerOsApiRequest/)
})

test("owner UI owns upload and reminder while Remote Operator has no upload or raw access", () => {
  const owner = read("app/admin/owner-listing-quality-report-control.tsx")
  const remote = read("app/admin/remote-live-optimization-operator.tsx")
  const listingQuality = read("app/admin/ebay/listing-quality/page.tsx")
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
  assert.match(listingQuality, /OwnerListingQualityReportControl/)
  assert.match(listingQuality, /Listings LIVE · Listing Quality/)
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

  const realWorkbookSql = read(
    "supabase/migrations/20260902201826_listing_quality_report_real_workbook_parser_v1.sql")
  assert.match(realWorkbookSql, /recognized_sheet_names text\[\]/)
  assert.match(realWorkbookSql, /recognized_sheet_count integer/)
  assert.match(realWorkbookSql, /source_signal_semantics jsonb/)
  assert.match(realWorkbookSql, /LISTING_QUALITY_SPECIFIC_RECOMMENDATION/)
  assert.match(realWorkbookSql, /VISUAL_COVERAGE_REVIEW/)
  assert.match(realWorkbookSql, /GOOGLE_SHOPPING_REJECTION/)
  assert.match(realWorkbookSql, /PROMOTION_VISIBILITY_OPPORTUNITY/)
  assert.match(realWorkbookSql, /security invoker/)
  assert.match(realWorkbookSql, /jsonb_to_recordset\(p_signals\)/)
  assert.match(realWorkbookSql, /from public, anon, authenticated/)
  assert.match(realWorkbookSql, /to service_role/)
  assert.doesNotMatch(realWorkbookSql,
    /marketplace_writes\s*=\s*[1-9]|listing_mutations|buyer_messages\s*=\s*[1-9]/)

  const importedByIndexSql = read(
    "supabase/migrations/20260902202013_listing_quality_report_imported_by_index_v1.sql")
  assert.match(importedByIndexSql,
    /ebay_listing_quality_report_imports\(imported_by\)/)

  const preparseSql = read(
    "supabase/migrations/20260902205318_listing_quality_report_preparse_diagnostics_v1.sql")
  assert.match(preparseSql, /failed_stage text/)
  assert.match(preparseSql, /request_transport_class text/)
  assert.match(preparseSql, /request_content_type_class text/)
  assert.match(preparseSql, /file_size_class text/)
  assert.match(preparseSql, /mime_type_class text/)
  assert.match(preparseSql, /deployment_id text/)
  assert.match(preparseSql, /RAW parser errors remain outside|raw parser errors remain outside/i)
})

test("real workbook parser is schema-discovered and never maps identity by title", () => {
  const parser = read("lib/ebay/ebay-listing-quality-report-import-v1.ts")
  const ownerImport = read("lib/ebay/ebay-listing-quality-report-owner-import-v1.ts")
  assert.match(parser, /selectionMethod: "SCHEMA_MULTI_SHEET"/)
  assert.match(parser, /categorySheetNameHardcoded: false/)
  assert.match(parser, /summaryGuideRowsExcluded: true/)
  assert.match(parser, /realCandidates\.flatMap\(rowsForCandidate\)/)
  assert.match(parser,
    /Array\.from\(\{ length: candidate\.header\.cells\.length \}/)
  assert.match(parser, /QUALITY_REPORT_XLSX_ROW_PARSE_FAILED/)
  assert.match(ownerImport, /QUALITY_REPORT_EXACT_ITEM_ID_REQUIRED/)
  assert.match(ownerImport, /QUALITY_REPORT_SKU_MAPPING_MISMATCH/)
  assert.match(ownerImport, /CANONICAL_CURRENT_LIVE_ITEM_ID/)
  assert.doesNotMatch(ownerImport, /liveByTitle|titleMatch|MATCHED_TITLE/)
  assert.match(ownerImport, /identifierValuesPersisted: false/)
})
