-- Immutable V2/V3 routing identity for image revisions.
alter table public.ebay_same_day_pilot_image_revisions
  add column if not exists strategy_version text not null default 'VISUAL_STRATEGY_V2',
  add column if not exists revision_contract text not null default 'LEGACY_VISUAL_STRATEGY_V2';

alter table public.ebay_same_day_pilot_image_revisions
  drop constraint if exists ebay_same_day_image_revision_strategy_contract_check;
alter table public.ebay_same_day_pilot_image_revisions
  add constraint ebay_same_day_image_revision_strategy_contract_check check (
    (strategy_version = 'VISUAL_STRATEGY_V2' and revision_contract = 'LEGACY_VISUAL_STRATEGY_V2')
    or (strategy_version = 'VISUAL_STRATEGY_V3' and revision_contract = 'REFERENCE_GUIDED_PRODUCT_GENERATION_V1')
  );

create or replace function public.prevent_ebay_revision_strategy_mutation()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if old.strategy_version is distinct from new.strategy_version
    or old.revision_contract is distinct from new.revision_contract then
    raise exception 'REVISION_STRATEGY_IMMUTABLE';
  end if;
  return new;
end $$;

drop trigger if exists ebay_revision_strategy_immutable on public.ebay_same_day_pilot_image_revisions;
create trigger ebay_revision_strategy_immutable
before update on public.ebay_same_day_pilot_image_revisions
for each row execute function public.prevent_ebay_revision_strategy_mutation();
