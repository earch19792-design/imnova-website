-- Scheduled monitor runs store identity verification in the canonical nested
-- metrics object. Preserve the flat dry-run field as a compatibility path.

do $migration$
declare
  v_definition text;
  v_updated_definition text;
  v_legacy_expression constant text :=
    'and run.metrics -> ''listingIdentityVerified'' = ''true''::jsonb';
  v_compatible_expression constant text :=
    'and (
          run.metrics -> ''listingIdentityVerified'' = ''true''::jsonb
          or run.metrics #> ''{listingIdentity,allActiveListingsVerified}'' = ''true''::jsonb
        )';
begin
  select pg_get_functiondef(
    'public.enqueue_ebay_monitoring_heartbeat_alerts(text,text,integer,integer,timestamptz)'::regprocedure
  ) into v_definition;

  if v_definition is null or strpos(v_definition, v_legacy_expression) = 0 then
    raise exception 'EBAY_MONITORING_LEGACY_IDENTITY_HEARTBEAT_EXPRESSION_NOT_FOUND';
  end if;

  v_updated_definition := replace(
    v_definition,
    v_legacy_expression,
    v_compatible_expression
  );

  if strpos(
    v_updated_definition,
    'listingIdentity,allActiveListingsVerified'
  ) = 0 then
    raise exception 'EBAY_MONITORING_NESTED_IDENTITY_HEARTBEAT_PATCH_FAILED';
  end if;

  execute v_updated_definition;
end;
$migration$;
