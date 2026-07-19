do $migration$
declare
  v_definition text;
  v_updated_definition text;
  v_five_minute_expression constant text :=
    'floor(extract(epoch from p_now) / 300) * 300';
  v_one_minute_expression constant text :=
    'floor(extract(epoch from p_now) / 60) * 60';
begin
  if not exists (
    select 1
    from public.ebay_same_day_pilot_scheduler_config
    where singleton = true
      and environment = 'STAGING'
      and deployment_scope = 'PREVIEW'
      and supabase_project_ref = 'vsfthqydfrdzulldbfbe'
      and schedule = '* * * * *'
      and enabled = true
  ) then
    raise notice 'SAME_DAY_PILOT_ONE_MINUTE_DISPATCH_SKIPPED_OUTSIDE_PREVIEW';
    return;
  end if;

  select pg_get_functiondef(
    'public.dispatch_same_day_pilot_staging_worker(text,timestamptz)'::regprocedure
  ) into v_definition;

  if v_definition is null or strpos(v_definition, v_five_minute_expression) = 0 then
    raise exception 'SAME_DAY_PILOT_FIVE_MINUTE_DISPATCH_EXPRESSION_NOT_FOUND';
  end if;

  v_updated_definition := replace(
    v_definition,
    v_five_minute_expression,
    v_one_minute_expression
  );
  v_updated_definition := replace(
    v_updated_definition,
    'Serialize a five-minute dispatch slot',
    'Serialize a one-minute dispatch slot'
  );

  if strpos(v_updated_definition, v_five_minute_expression) > 0 then
    raise exception 'SAME_DAY_PILOT_DISPATCH_EXPRESSION_REPLACEMENT_INCOMPLETE';
  end if;

  execute v_updated_definition;
end;
$migration$;
