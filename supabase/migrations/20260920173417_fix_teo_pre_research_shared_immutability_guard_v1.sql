-- TEO_PRE_RESEARCH_SHARED_IMMUTABILITY_GUARD_FIX_V1
-- Keep the existing fail-closed identity rules while avoiding references to
-- columns that do not exist on the other table sharing this trigger function.

create or replace function public.guard_seller_os_pre_research_batch_immutability_v1()
returns trigger language plpgsql set search_path = '' as $function$
declare
  v_old jsonb := to_jsonb(old);
  v_new jsonb := to_jsonb(new);
begin
  if tg_table_name='seller_os_pre_research_batches_v1' then
    if v_old->'marketplace_account_key' is distinct from
        v_new->'marketplace_account_key'
        or v_old->'source_snapshot_id' is distinct from
          v_new->'source_snapshot_id'
        or v_old->'candidate_identity_digest' is distinct from
          v_new->'candidate_identity_digest'
        or v_old->'candidate_count' is distinct from v_new->'candidate_count'
        or v_old->'contract_version' is distinct from v_new->'contract_version'
        or v_old->'owner_authorization_id' is distinct from
          v_new->'owner_authorization_id'
        or v_old->'owner_user_id' is distinct from v_new->'owner_user_id'
        or v_old->'command_client_id' is distinct from v_new->'command_client_id'
        or v_old->'client_idempotency_key' is distinct from
          v_new->'client_idempotency_key' then
      raise exception 'TEO_PRE_RESEARCH_BATCH_IDENTITY_IMMUTABLE';
    end if;
  elsif tg_table_name='seller_os_pre_research_batch_members_v1' then
    if v_old->'batch_id' is distinct from v_new->'batch_id'
        or v_old->'ordinal' is distinct from v_new->'ordinal'
        or v_old->'luna_product_id' is distinct from v_new->'luna_product_id'
        or v_old->'luna_variant_id' is distinct from v_new->'luna_variant_id'
        or v_old->'luna_sku' is distinct from v_new->'luna_sku'
        or v_old->'source_candidate_key' is distinct from
          v_new->'source_candidate_key'
        or v_old->'product_truth_fingerprint' is distinct from
          v_new->'product_truth_fingerprint'
        or (v_old->>'plan_id' is not null
          and v_old->'plan_id' is distinct from v_new->'plan_id') then
      raise exception 'TEO_PRE_RESEARCH_BATCH_MEMBERSHIP_IMMUTABLE';
    end if;
  else
    raise exception 'TEO_PRE_RESEARCH_IMMUTABILITY_GUARD_TABLE_INVALID';
  end if;
  return new;
end $function$;

revoke all on function public.guard_seller_os_pre_research_batch_immutability_v1()
  from public, anon, authenticated, service_role;
