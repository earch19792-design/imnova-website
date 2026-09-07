-- The capture tables intentionally grant service_role INSERT but not UPDATE.
-- Commercial annotation is therefore a bounded authority operation and must
-- execute through this validated definer RPC, not rely on caller table grants.

create or replace function public.annotate_product_research_capture_commercial_v1(
  p_marketplace_account_key text,
  p_capture_batch_id uuid,
  p_quality_status text,
  p_quality_metrics jsonb,
  p_annotations jsonb
) returns boolean
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_expected integer := jsonb_array_length(coalesce(p_annotations, '[]'::jsonb));
  v_updated integer := 0;
begin
  if not public.is_seller_os_service_role_request_v1()
      or char_length(trim(coalesce(p_marketplace_account_key, ''))) not between 8 and 160
      or p_capture_batch_id is null
      or p_quality_status not in ('COMMERCIALLY_SUFFICIENT',
        'LOW_PRECISION_REFORMULATION_REQUIRED','NO_EVIDENCE_UNPROVEN')
      or jsonb_typeof(coalesce(p_quality_metrics, '{}'::jsonb)) <> 'object'
      or jsonb_typeof(coalesce(p_annotations, '[]'::jsonb)) <> 'array' then
    raise exception 'PRODUCT_RESEARCH_COMMERCIAL_ANNOTATION_INVALID';
  end if;

  if not exists (
    select 1
    from public.marketplace_product_research_capture_batches batch
    where batch.id = p_capture_batch_id
      and batch.marketplace_account_key = p_marketplace_account_key
      and batch.marketplace = 'EBAY_US'
  ) then
    raise exception 'PRODUCT_RESEARCH_COMMERCIAL_ANNOTATION_SCOPE_INVALID';
  end if;

  update public.marketplace_product_research_capture_observations observation
  set bounded_title_evidence = annotation.bounded_title_evidence,
      commercial_comparable_classification =
        annotation.commercial_comparable_classification,
      commercial_classification_reasons =
        coalesce(annotation.commercial_classification_reasons, '{}'::text[])
  from jsonb_to_recordset(coalesce(p_annotations, '[]'::jsonb)) as annotation(
    evidence_deduplication_key text,
    bounded_title_evidence text,
    commercial_comparable_classification text,
    commercial_classification_reasons text[]
  )
  where observation.capture_batch_id = p_capture_batch_id
    and observation.marketplace_account_key = p_marketplace_account_key
    and observation.marketplace = 'EBAY_US'
    and observation.evidence_deduplication_key =
      annotation.evidence_deduplication_key;
  get diagnostics v_updated = row_count;

  if v_updated <> v_expected then
    raise exception 'PRODUCT_RESEARCH_COMMERCIAL_ANNOTATION_COUNT_MISMATCH';
  end if;

  update public.marketplace_product_research_capture_batches batch
  set commercial_quality_status = p_quality_status,
      commercial_quality_metrics = p_quality_metrics
  where batch.id = p_capture_batch_id
    and batch.marketplace_account_key = p_marketplace_account_key
    and batch.marketplace = 'EBAY_US';
  if not found then
    raise exception 'PRODUCT_RESEARCH_COMMERCIAL_ANNOTATION_SCOPE_INVALID';
  end if;
  return true;
end;
$$;

revoke all on function public.annotate_product_research_capture_commercial_v1(
  text, uuid, text, jsonb, jsonb
) from public, anon, authenticated;
grant execute on function public.annotate_product_research_capture_commercial_v1(
  text, uuid, text, jsonb, jsonb
) to service_role;

comment on function public.annotate_product_research_capture_commercial_v1(
  text, uuid, text, jsonb, jsonb
) is 'Bounded service-role authority for annotating one exact Product Research capture. Uses validated scope and row-count parity; grants no direct UPDATE access to capture evidence tables.';

notify pgrst, 'reload schema';
