-- Cover the owner foreign key used by the scoped report import audit trail.
create index if not exists ebay_quality_import_imported_by_idx
  on public.ebay_listing_quality_report_imports(imported_by);
