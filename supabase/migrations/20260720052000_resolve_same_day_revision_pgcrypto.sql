alter function public.complete_ebay_same_day_image_revision(
  uuid, uuid, uuid, uuid[], jsonb
) set search_path = public, extensions, pg_temp;

comment on function public.complete_ebay_same_day_image_revision(
  uuid, uuid, uuid, uuid[], jsonb
) is 'Completes an exact six-image V3 revision with pgcrypto resolved from the trusted extensions schema.';
