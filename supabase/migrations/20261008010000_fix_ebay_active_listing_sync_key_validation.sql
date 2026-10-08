begin;

do $migration$
declare
  v_definition text;
  v_original constant text := $original$
        or coalesce(item.value ->> 'sync_key', '') !~ '^[^[:cntrl:]]{1,500}$'
$original$;
  v_replacement constant text := $replacement$
        or coalesce(item.value ->> 'sync_key', '') = ''
        or length(item.value ->> 'sync_key') > 500
        or item.value ->> 'sync_key' ~ '[[:cntrl:]]'
$replacement$;
begin
  select pg_get_functiondef(
    'public.commit_ebay_active_listing_sync_generation(text,uuid,bigint,timestamptz,jsonb)'::regprocedure
  )
  into v_definition;

  if position(v_original in v_definition) = 0 then
    raise exception 'EBAY_ACTIVE_LISTING_SYNC_VALIDATION_PATCH_TARGET_MISSING';
  end if;

  execute replace(v_definition, v_original, v_replacement);
end;
$migration$;

commit;
