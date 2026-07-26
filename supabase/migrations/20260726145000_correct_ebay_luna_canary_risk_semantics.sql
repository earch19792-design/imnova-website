begin;

-- Category/readiness guards remain independent hard gates. The selector risk
-- axis represents only explicit supplier/product restrictions and must not
-- double-count missing taxonomy, images, identity or package facts.
do $$
begin
  if not exists (
    select 1
    from public.ebay_luna_selector_policies_v2
  ) or exists (
    select 1
    from public.ebay_luna_selector_policies_v2
    where enabled is distinct from false
      or shadow_mode is distinct from true
      or lower(
        coalesce(policy ->> 'bootstrapCanaryEnabled', 'false')
      ) <> 'false'
  ) then
    raise exception
      'EBAY_LUNA_SELECTOR_POLICY_MUST_BE_DISABLED_FOR_RISK_BACKFILL';
  end if;
end;
$$;

update public.ebay_luna_opportunity_queue
set risk_score = case
  when jsonb_typeof(
    assessment #> '{candidate,restrictionGuards}'
  ) = 'array'
  then case
    when jsonb_array_length(
      assessment #> '{candidate,restrictionGuards}'
    ) = 0
    then 0
    else 100
  end
  else null
end
where risk_score is distinct from case
  when jsonb_typeof(
    assessment #> '{candidate,restrictionGuards}'
  ) = 'array'
  then case
    when jsonb_array_length(
      assessment #> '{candidate,restrictionGuards}'
    ) = 0
    then 0
    else 100
  end
  else null
end;

comment on column public.ebay_luna_opportunity_queue.risk_score is
  'Explicit supplier/product restriction risk only. Category, identity, images and package readiness remain separate fail-closed hard gates.';

notify pgrst, 'reload schema';

commit;
