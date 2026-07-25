-- Make the six-image review package atomic at the database boundary and bind
-- every OpenAI context run to the exact approved package/product chain.

create or replace function public.enforce_ebay_openai_image_context_scope()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  perform 1
  from public.ebay_listing_packages package_row
  join public.ebay_luna_opportunity_queue opportunity
    on opportunity.id = package_row.opportunity_id
    and opportunity.candidate_key = package_row.candidate_key
  join public.marketplace_listing_generations generation
    on generation.id = new.listing_generation_id
  join public.marketplace_listing_decision_packages decision
    on decision.id = generation.decision_package_id
    and decision.marketplace_account_key = generation.marketplace_account_key
    and decision.marketplace = generation.marketplace
  where package_row.id = new.listing_package_id
    and package_row.account_key = new.account_key
    and package_row.created_by = new.created_by
    and package_row.status <> 'archived'
    and generation.marketplace_account_key = new.account_key
    and generation.marketplace = 'EBAY_US'
    and generation.status = 'APPROVED'
    and generation.identity_fingerprint = new.identity_fingerprint
    and generation.identity_fingerprint = decision.product_identity_fingerprint
    and generation.decision_package_hash = decision.package_hash
    and decision.status = 'APPROVED'
    and decision.supplier_sku = opportunity.supplier_sku;
  if not found then
    raise exception 'EBAY_IMAGE_OPENAI_APPROVAL_SCOPE_INVALID';
  end if;
  return new;
end;
$$;

drop trigger if exists enforce_ebay_openai_image_context_scope
  on public.ebay_openai_image_context_runs;
create trigger enforce_ebay_openai_image_context_scope
before insert or update of account_key, created_by, listing_package_id,
  listing_generation_id, identity_fingerprint
on public.ebay_openai_image_context_runs
for each row execute function public.enforce_ebay_openai_image_context_scope();

create or replace function public.ebay_create_pending_listing_image_set(
  p_package_id uuid,
  p_account_key text,
  p_actor uuid,
  p_opportunity_id uuid,
  p_candidate_key text,
  p_assets jsonb
)
returns setof public.ebay_listing_image_assets
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_asset jsonb;
  v_count integer;
begin
  if jsonb_typeof(p_assets) <> 'array' then
    raise exception 'EBAY_IMAGE_ASSET_SET_ARRAY_REQUIRED';
  end if;
  v_count := jsonb_array_length(p_assets);
  if v_count < 1 or v_count > 6 then
    raise exception 'EBAY_IMAGE_ASSET_SET_SIZE_INVALID';
  end if;

  perform public.assert_ebay_listing_package_account_scope(
    p_package_id, p_account_key, p_actor
  );

  for v_asset in
    select value from jsonb_array_elements(p_assets)
  loop
    if jsonb_typeof(v_asset) <> 'object' then
      raise exception 'EBAY_IMAGE_ASSET_SET_ENTRY_INVALID';
    end if;
    return query select *
    from public.ebay_create_pending_listing_image(
      p_package_id,
      p_account_key,
      p_actor,
      p_opportunity_id,
      p_candidate_key,
      v_asset
    );
  end loop;
end;
$$;

revoke all on function public.enforce_ebay_openai_image_context_scope()
  from public, anon, authenticated, service_role;
revoke all on function public.ebay_create_pending_listing_image_set(
  uuid, text, uuid, uuid, text, jsonb
) from public, anon, authenticated;
grant execute on function public.ebay_create_pending_listing_image_set(
  uuid, text, uuid, uuid, text, jsonb
) to service_role;

notify pgrst, 'reload schema';
