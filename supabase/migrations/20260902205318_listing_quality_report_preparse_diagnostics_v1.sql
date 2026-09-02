-- Persist only bounded transport/runtime stage metadata. Workbook bytes,
-- original MIME strings, and raw parser errors remain outside the database.

alter table public.ebay_listing_quality_report_upload_attempts
  add column if not exists failed_stage text not null default 'UNKNOWN_LEGACY',
  add column if not exists request_transport_class text not null
    default 'UNKNOWN_LEGACY',
  add column if not exists request_content_type_class text not null
    default 'UNKNOWN_LEGACY',
  add column if not exists file_size_class text not null
    default 'UNKNOWN_LEGACY',
  add column if not exists mime_type_class text not null
    default 'UNKNOWN_LEGACY',
  add column if not exists deployment_id text not null
    default 'UNAVAILABLE_LEGACY';

alter table public.ebay_listing_quality_report_upload_attempts
  add constraint ebay_quality_attempt_failed_stage_check check (
    failed_stage in (
      'REQUEST_BODY', 'FILE_BUFFER', 'WORKBOOK_OPEN',
      'WORKBOOK_SHEET_ENUMERATION', 'SCHEMA_DISCOVERY', 'ROW_PARSE',
      'IMPORT_VALIDATION', 'IMPORT_RPC', 'ATTEMPT_PERSIST',
      'NONE', 'UNKNOWN_LEGACY'
    )
  ),
  add constraint ebay_quality_attempt_transport_class_check check (
    request_transport_class in ('JSON_BASE64', 'UNKNOWN_LEGACY')
    and request_content_type_class in (
      'APPLICATION_JSON', 'OTHER', 'UNSPECIFIED', 'UNKNOWN_LEGACY'
    )
  ),
  add constraint ebay_quality_attempt_file_class_check check (
    file_size_class in (
      'UNDER_256_KIB', 'UNDER_1_MIB', 'UNDER_3_MIB',
      'OVER_LIMIT', 'UNKNOWN_LEGACY'
    )
    and mime_type_class in (
      'XLSX_STANDARD', 'OCTET_STREAM', 'UNSPECIFIED',
      'OTHER', 'UNKNOWN_LEGACY'
    )
  ),
  add constraint ebay_quality_attempt_deployment_check check (
    deployment_id = 'UNAVAILABLE_LEGACY'
    or deployment_id = 'UNAVAILABLE_RUNTIME'
    or deployment_id ~ '^dpl_[A-Za-z0-9]{20,80}$'
  );

comment on column
  public.ebay_listing_quality_report_upload_attempts.failed_stage is
  'Sanitized last pipeline stage reached; never contains raw parser errors.';
comment on column
  public.ebay_listing_quality_report_upload_attempts.mime_type_class is
  'Allowlisted MIME classification only; the browser-provided MIME string is not stored.';
comment on column
  public.ebay_listing_quality_report_upload_attempts.deployment_id is
  'Vercel deployment identifier when runtime-provided, otherwise a bounded unavailable marker.';
