-- Preserve account-scoped category receipts across normal queue rescans.
-- The scanner replaces assessment; OWNER writes the current receipt there.
-- Merge from the locked old row so a concurrent scan cannot erase history.
create or replace function public.preserve_ebay_opportunity_category_authority_v1()
returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
declare
  old_authority jsonb;
  next_authority jsonb;
begin
  old_authority := case
    when jsonb_typeof(old.assessment->'categoryAuthorityByAccountV1') = 'object'
      then old.assessment->'categoryAuthorityByAccountV1'
    else '{}'::jsonb end;
  next_authority := case
    when jsonb_typeof(new.assessment->'categoryAuthorityByAccountV1') = 'object'
      then new.assessment->'categoryAuthorityByAccountV1'
    else '{}'::jsonb end;
  if old_authority <> '{}'::jsonb then
    new.assessment := coalesce(new.assessment, '{}'::jsonb) ||
      jsonb_build_object('categoryAuthorityByAccountV1',
        old_authority || next_authority);
  end if;
  return new;
end;
$$;

drop trigger if exists preserve_ebay_opportunity_category_authority_v1
  on public.ebay_luna_opportunity_queue;
create trigger preserve_ebay_opportunity_category_authority_v1
before update of assessment, market_radar_product_id, supplier_product_id,
  supplier_variant_id, supplier_sku on public.ebay_luna_opportunity_queue
for each row execute function public.preserve_ebay_opportunity_category_authority_v1();
