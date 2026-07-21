-- The competitor dry-run gate protects two tables with different authorization
-- column names. Reading both NEW fields in a CASE expression makes Postgres
-- resolve the absent field for the scheduler table and rejects valid renewals.
-- Resolve the applicable UUID through JSON instead, while preserving every
-- existing dry-run requirement below.

create or replace function public.enforce_competitor_watch_dry_run_gate()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_dry_run_id uuid;
  v_dry_run public.commercial_monitor_runs%rowtype;
begin
  v_dry_run_id := coalesce(
    nullif(to_jsonb(new) ->> 'dry_run_id', ''),
    nullif(to_jsonb(new) ->> 'authorized_by_dry_run_id', '')
  )::uuid;
  if v_dry_run_id is null then return new; end if;

  select * into v_dry_run
  from public.commercial_monitor_runs
  where id = v_dry_run_id
    and trigger_source = 'dry_run';

  if not found
    or v_dry_run.status <> 'completed'
    or v_dry_run.dry_run_satisfactory is not true
    or jsonb_typeof(v_dry_run.readers -> 'competitors') is distinct from 'object'
    or v_dry_run.readers #>> '{competitors,status}' is distinct from 'available'
    or v_dry_run.readers #> '{competitors,metrics,activeOfferTreatedAsConfirmedSale}'
      is distinct from 'false'::jsonb
    or v_dry_run.readers #> '{competitors,metrics,rawCompetitorContentStored}'
      is distinct from 'false'::jsonb
    or v_dry_run.readers #> '{competitors,metrics,ebayWrites}'
      is distinct from '0'::jsonb
    or (case
      when jsonb_typeof(v_dry_run.metrics -> 'competitorListingsRead') = 'number'
        then (v_dry_run.metrics ->> 'competitorListingsRead')::numeric > 0
      else false
    end) is not true then
    raise exception 'COMMERCIAL_MONITOR_COMPETITOR_DRY_RUN_NOT_SATISFIED';
  end if;
  return new;
end;
$$;

revoke all on function public.enforce_competitor_watch_dry_run_gate()
  from public, anon, authenticated;
grant execute on function public.enforce_competitor_watch_dry_run_gate()
  to service_role;
