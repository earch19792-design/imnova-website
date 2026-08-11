-- Apply one previously approved Registry CREATE_NEW + MARK_STALE tranche in a
-- single PostgreSQL transaction. The caller must re-read eBay and bind the
-- current package immediately before invoking this database-side CAS boundary.
-- Package handles and evidence fingerprints are audit bindings, not authority.

create or replace function public.apply_ebay_registry_repair_v1(
  p_account_key text,
  p_package_handle text,
  p_evidence_fingerprint text,
  p_expected_create_count integer,
  p_expected_stale_count integer,
  p_expected_human_review_count integer,
  p_create_candidates jsonb,
  p_stale_candidates jsonb
)
returns table(
  result_status text,
  create_inserted integer,
  stale_updated integer,
  repair_updated integer,
  human_review_mutated integer
)
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $function$
declare
  v_create_count integer;
  v_stale_count integer;
  v_create_inserted integer := 0;
  v_stale_updated integer := 0;
  v_post_create_count integer := 0;
  v_post_stale_count integer := 0;
  v_applied_at timestamptz := clock_timestamp();
begin
  if p_account_key is null
    or p_account_key !~ '^[A-Za-z0-9._-]{1,80}:[0-9a-f]{64}$'
    or p_package_handle is null
    or p_package_handle !~ '^rr_package_[0-9a-f]{24}$'
    or p_evidence_fingerprint is null
    or p_evidence_fingerprint !~ '^rr_evidence_[0-9a-f]{24}$'
    or p_expected_create_count is null
    or p_expected_create_count < 0
    or p_expected_create_count > 5000
    or p_expected_stale_count is null
    or p_expected_stale_count < 0
    or p_expected_stale_count > 5000
    or p_expected_human_review_count is null
    or p_expected_human_review_count < 0
    or p_expected_human_review_count > 5000
    or p_create_candidates is null
    or jsonb_typeof(p_create_candidates) <> 'array'
    or p_stale_candidates is null
    or jsonb_typeof(p_stale_candidates) <> 'array' then
    raise exception 'EBAY_REGISTRY_REPAIR_INPUT_INVALID'
      using errcode = 'P0001';
  end if;

  v_create_count := jsonb_array_length(p_create_candidates);
  v_stale_count := jsonb_array_length(p_stale_candidates);
  if v_create_count <> p_expected_create_count
    or v_stale_count <> p_expected_stale_count then
    raise exception 'EBAY_REGISTRY_REPAIR_COUNT_MISMATCH'
      using errcode = 'P0001';
  end if;

  -- CREATE inputs contain only source evidence needed for a canonical row.
  -- listing_status, sync_run_id, sync_generation and updated_at are derived.
  if exists (
    select 1
    from jsonb_array_elements(p_create_candidates) candidate(value)
    where jsonb_typeof(candidate.value) <> 'object'
      or (candidate.value - array[
        'source', 'account_key', 'sync_key', 'ebay_item_id', 'title',
        'ebay_sku', 'ebay_quantity', 'ebay_price', 'currency',
        'last_ebay_sync_at', 'raw_payload'
      ]::text[]) <> '{}'::jsonb
      or not (candidate.value ?& array[
        'source', 'account_key', 'sync_key', 'ebay_item_id', 'title',
        'ebay_sku', 'ebay_quantity', 'ebay_price', 'currency',
        'last_ebay_sync_at', 'raw_payload'
      ]::text[])
      or jsonb_typeof(candidate.value -> 'raw_payload') <> 'object'
  ) then
    raise exception 'EBAY_REGISTRY_REPAIR_INPUT_INVALID'
      using errcode = 'P0001';
  end if;

  if exists (
    select 1
    from jsonb_array_elements(p_create_candidates) candidate(value)
    where candidate.value ->> 'source' not in (
        'EBAY_TRADING_GET_MY_EBAY_SELLING',
        'EBAY_TRADING_GET_ITEM_READONLY'
      )
      or candidate.value ->> 'account_key' is distinct from p_account_key
      or coalesce(candidate.value ->> 'ebay_item_id', '') !~ '^[0-9]{9,20}$'
      or candidate.value ->> 'sync_key' is distinct from concat(
        candidate.value ->> 'source', ':', p_account_key, ':',
        candidate.value ->> 'ebay_item_id'
      )
      or char_length(candidate.value ->> 'sync_key') > 500
      or nullif(trim(candidate.value ->> 'title'), '') is null
      or char_length(candidate.value ->> 'title') > 1000
      or candidate.value ->> 'title' ~ '[[:cntrl:]]'
      or (
        candidate.value -> 'ebay_sku' <> 'null'::jsonb
        and (
          char_length(candidate.value ->> 'ebay_sku') not between 1 and 80
          or candidate.value ->> 'ebay_sku' ~ '[[:cntrl:]]'
        )
      )
      or (
        candidate.value -> 'ebay_quantity' <> 'null'::jsonb
        and coalesce(candidate.value ->> 'ebay_quantity', '') !~ '^[0-9]+$'
      )
      or (
        candidate.value -> 'ebay_price' <> 'null'::jsonb
        and coalesce(candidate.value ->> 'ebay_price', '')
          !~ '^[0-9]+([.][0-9]{1,2})?$'
      )
      or coalesce(candidate.value ->> 'currency', '') !~ '^[A-Z]{3}$'
      or case
        when coalesce(candidate.value ->> 'last_ebay_sync_at', '')
          ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}([.][0-9]{1,6})?Z$'
        then (candidate.value ->> 'last_ebay_sync_at')::timestamptz
          > v_applied_at + interval '5 minutes'
          or (candidate.value ->> 'last_ebay_sync_at')::timestamptz
            < v_applied_at - interval '30 minutes'
        else true
      end
  ) then
    raise exception 'EBAY_REGISTRY_REPAIR_INPUT_INVALID'
      using errcode = 'P0001';
  end if;

  -- The accepted payload is a bounded, scalar-only sanitized identity
  -- snapshot. Unknown keys and secret/buyer-bearing content fail closed.
  if exists (
    select 1
    from jsonb_array_elements(p_create_candidates) candidate(value)
    where octet_length((candidate.value -> 'raw_payload')::text) > 32768
      or ((candidate.value -> 'raw_payload') - array[
        'source', 'marketplaceId', 'listingState', 'variationKey',
        'observedAt', 'offerId', 'categoryId', 'offerStatus',
        'opportunityMappingState', 'opportunityMappingSource'
      ]::text[]) <> '{}'::jsonb
      or not ((candidate.value -> 'raw_payload') ?& array[
        'source', 'marketplaceId', 'listingState', 'observedAt'
      ]::text[])
      or candidate.value #>> '{raw_payload,source}'
        is distinct from candidate.value ->> 'source'
      or candidate.value #>> '{raw_payload,marketplaceId}'
        is distinct from 'EBAY_US'
      or candidate.value #>> '{raw_payload,listingState}'
        is distinct from 'ACTIVE'
      or coalesce(candidate.value #>> '{raw_payload,observedAt}', '')
        !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}([.][0-9]{1,6})?Z$'
      or exists (
        select 1
        from jsonb_each(candidate.value -> 'raw_payload') field(key, value)
        where jsonb_typeof(field.value) in ('object', 'array')
          or lower(regexp_replace(field.key, '[^a-z0-9]', '', 'g'))
            ~ '(authorization|cookie|token|secret|credential|buyer|shipping|address|payment|email|phone)'
      )
      or (candidate.value -> 'raw_payload')::text ~* (
        '-----BEGIN [A-Z ]*PRIVATE KEY-----|'
        || '(^|[^A-Za-z0-9_])sk-(proj-)?[A-Za-z0-9_-]{20,}|'
        || 'sb_secret_[A-Za-z0-9_-]{20,}|'
        || 'Bearer[[:space:]]+[A-Za-z0-9._~+/-]{20,}|'
        || '[A-Z0-9._%+-]+@[A-Z0-9.-]+[.][A-Z]{2,}|'
        || '(buyer|shipping|address|payment|cookie|authorization|refresh[_ -]?token|access[_ -]?token)'
      )
  ) then
    raise exception 'EBAY_REGISTRY_REPAIR_RAW_PAYLOAD_UNSAFE'
      using errcode = 'P0001';
  end if;

  -- STALE inputs are exact old-row CAS evidence. No new values are accepted.
  if exists (
    select 1
    from jsonb_array_elements(p_stale_candidates) candidate(value)
    where jsonb_typeof(candidate.value) <> 'object'
      or (candidate.value - array[
        'id', 'account_key', 'expected_source', 'expected_sync_key',
        'expected_listing_status', 'expected_ebay_item_id',
        'expected_ebay_sku', 'expected_sync_generation',
        'expected_updated_at'
      ]::text[]) <> '{}'::jsonb
      or not (candidate.value ?& array[
        'id', 'account_key', 'expected_source', 'expected_sync_key',
        'expected_listing_status', 'expected_ebay_item_id',
        'expected_ebay_sku', 'expected_sync_generation',
        'expected_updated_at'
      ]::text[])
      or coalesce(candidate.value ->> 'id', '')
        !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
      or candidate.value ->> 'account_key' is distinct from p_account_key
      or coalesce(candidate.value ->> 'expected_source', '')
        !~ '^[A-Za-z0-9._:-]{1,100}$'
      or (
        candidate.value -> 'expected_sync_key' <> 'null'::jsonb
        and (
          char_length(candidate.value ->> 'expected_sync_key') not between 1 and 500
          or candidate.value ->> 'expected_sync_key' ~ '[[:cntrl:]]'
        )
      )
      or candidate.value ->> 'expected_listing_status' is distinct from 'active'
      or coalesce(candidate.value ->> 'expected_ebay_item_id', '')
        !~ '^[0-9]{9,20}$'
      or (
        candidate.value -> 'expected_ebay_sku' <> 'null'::jsonb
        and (
          char_length(candidate.value ->> 'expected_ebay_sku') not between 1 and 80
          or candidate.value ->> 'expected_ebay_sku' ~ '[[:cntrl:]]'
        )
      )
      or coalesce(candidate.value ->> 'expected_sync_generation', '')
        !~ '^[0-9]+$'
      or coalesce(candidate.value ->> 'expected_updated_at', '')
        !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}([.][0-9]{1,6})?([+]00:00|Z)$'
  ) then
    raise exception 'EBAY_REGISTRY_REPAIR_INPUT_INVALID'
      using errcode = 'P0001';
  end if;

  if (
    select count(distinct candidate.value ->> 'ebay_item_id')
    from jsonb_array_elements(p_create_candidates) candidate(value)
  ) <> v_create_count
    or (
      select count(distinct candidate.value ->> 'sync_key')
      from jsonb_array_elements(p_create_candidates) candidate(value)
    ) <> v_create_count
    or (
      select count(distinct candidate.value ->> 'id')
      from jsonb_array_elements(p_stale_candidates) candidate(value)
    ) <> v_stale_count then
    raise exception 'EBAY_REGISTRY_REPAIR_INPUT_INVALID'
      using errcode = 'P0001';
  end if;

  if exists (
    select 1
    from jsonb_array_elements(p_create_candidates) create_candidate(value)
    join jsonb_array_elements(p_stale_candidates) stale_candidate(value)
      on create_candidate.value ->> 'ebay_item_id' =
          stale_candidate.value ->> 'expected_ebay_item_id'
        or (
          stale_candidate.value -> 'expected_sync_key' <> 'null'::jsonb
          and create_candidate.value ->> 'sync_key' =
            stale_candidate.value ->> 'expected_sync_key'
        )
  ) then
    raise exception 'EBAY_REGISTRY_REPAIR_ACTION_SET_OVERLAP'
      using errcode = 'P0001';
  end if;

  -- SHARE ROW EXCLUSIVE conflicts with ordinary INSERT/UPDATE/DELETE locks.
  -- It closes the absence-CAS race with existing writers for this short RPC.
  lock table public.ebay_active_listings in share row exclusive mode;
  perform pg_advisory_xact_lock(
    hashtextextended(concat('ebay-registry-repair:', p_account_key), 0)
  );

  if exists (
    select 1
    from public.ebay_active_listings existing
    join jsonb_array_elements(p_create_candidates) candidate(value)
      on existing.sync_key = candidate.value ->> 'sync_key'
  ) then
    raise exception 'EBAY_REGISTRY_REPAIR_SYNC_KEY_COLLISION'
      using errcode = 'P0001';
  end if;

  if exists (
    select 1
    from public.ebay_active_listings existing
    join jsonb_array_elements(p_create_candidates) candidate(value)
      on existing.ebay_item_id = candidate.value ->> 'ebay_item_id'
    where existing.account_key is distinct from p_account_key
  ) then
    raise exception 'EBAY_REGISTRY_REPAIR_ACCOUNT_SCOPE_MISMATCH'
      using errcode = 'P0001';
  end if;

  if exists (
    select 1
    from public.ebay_active_listings existing
    join jsonb_array_elements(p_create_candidates) candidate(value)
      on existing.ebay_item_id = candidate.value ->> 'ebay_item_id'
  ) then
    raise exception 'EBAY_REGISTRY_REPAIR_CREATE_ABSENCE_CAS_FAILED'
      using errcode = 'P0001';
  end if;

  if exists (
    select 1
    from public.ebay_active_listings existing
    join jsonb_array_elements(p_stale_candidates) candidate(value)
      on existing.id = (candidate.value ->> 'id')::uuid
    where existing.account_key is distinct from p_account_key
  ) then
    raise exception 'EBAY_REGISTRY_REPAIR_ACCOUNT_SCOPE_MISMATCH'
      using errcode = 'P0001';
  end if;

  if (
    select count(*)
    from public.ebay_active_listings existing
    join jsonb_to_recordset(p_stale_candidates) as candidate(
      id uuid,
      account_key text,
      expected_source text,
      expected_sync_key text,
      expected_listing_status text,
      expected_ebay_item_id text,
      expected_ebay_sku text,
      expected_sync_generation bigint,
      expected_updated_at timestamptz
    ) on existing.id = candidate.id
    where existing.account_key = candidate.account_key
      and existing.source = candidate.expected_source
      and existing.sync_key is not distinct from candidate.expected_sync_key
      and existing.listing_status = candidate.expected_listing_status
      and existing.ebay_item_id = candidate.expected_ebay_item_id
      and existing.ebay_sku is not distinct from candidate.expected_ebay_sku
      and existing.sync_generation = candidate.expected_sync_generation
      and existing.updated_at = candidate.expected_updated_at
  ) <> v_stale_count then
    raise exception 'EBAY_REGISTRY_REPAIR_STALE_ROW_CAS_FAILED'
      using errcode = 'P0001';
  end if;

  begin
    insert into public.ebay_active_listings (
      source,
      account_key,
      sync_key,
      sync_run_id,
      sync_generation,
      ebay_item_id,
      listing_status,
      title,
      ebay_sku,
      ebay_quantity,
      ebay_price,
      currency,
      last_ebay_sync_at,
      raw_payload,
      updated_at
    )
    select
      candidate.source,
      p_account_key,
      candidate.sync_key,
      null,
      0,
      candidate.ebay_item_id,
      'active',
      candidate.title,
      candidate.ebay_sku,
      candidate.ebay_quantity,
      candidate.ebay_price,
      candidate.currency,
      candidate.last_ebay_sync_at,
      candidate.raw_payload,
      v_applied_at
    from jsonb_to_recordset(p_create_candidates) as candidate(
      source text,
      account_key text,
      sync_key text,
      ebay_item_id text,
      title text,
      ebay_sku text,
      ebay_quantity integer,
      ebay_price numeric,
      currency text,
      last_ebay_sync_at timestamptz,
      raw_payload jsonb
    );
    get diagnostics v_create_inserted = row_count;

    update public.ebay_active_listings existing
    set listing_status = 'ended',
        updated_at = v_applied_at
    from jsonb_to_recordset(p_stale_candidates) as candidate(
      id uuid,
      account_key text,
      expected_source text,
      expected_sync_key text,
      expected_listing_status text,
      expected_ebay_item_id text,
      expected_ebay_sku text,
      expected_sync_generation bigint,
      expected_updated_at timestamptz
    )
    where existing.id = candidate.id
      and existing.account_key = candidate.account_key
      and existing.source = candidate.expected_source
      and existing.sync_key is not distinct from candidate.expected_sync_key
      and existing.listing_status = candidate.expected_listing_status
      and existing.ebay_item_id = candidate.expected_ebay_item_id
      and existing.ebay_sku is not distinct from candidate.expected_ebay_sku
      and existing.sync_generation = candidate.expected_sync_generation
      and existing.updated_at = candidate.expected_updated_at;
    get diagnostics v_stale_updated = row_count;
  exception
    when unique_violation or not_null_violation or check_violation
      or foreign_key_violation or numeric_value_out_of_range then
      raise exception 'EBAY_REGISTRY_REPAIR_DATABASE_CONSTRAINT_FAILED'
        using errcode = 'P0001';
  end;

  if v_create_inserted <> p_expected_create_count
    or v_stale_updated <> p_expected_stale_count then
    raise exception 'EBAY_REGISTRY_REPAIR_AFFECTED_ROW_COUNT_MISMATCH'
      using errcode = 'P0001';
  end if;

  select count(*) into v_post_create_count
  from public.ebay_active_listings existing
  join jsonb_to_recordset(p_create_candidates) as candidate(
    source text,
    account_key text,
    sync_key text,
    ebay_item_id text
  ) on existing.account_key = candidate.account_key
    and existing.source = candidate.source
    and existing.sync_key = candidate.sync_key
    and existing.ebay_item_id = candidate.ebay_item_id
  where existing.listing_status = 'active';

  select count(*) into v_post_stale_count
  from public.ebay_active_listings existing
  join jsonb_to_recordset(p_stale_candidates) as candidate(
    id uuid,
    account_key text,
    expected_source text,
    expected_sync_key text,
    expected_ebay_item_id text,
    expected_ebay_sku text,
    expected_sync_generation bigint
  ) on existing.id = candidate.id
  where existing.account_key = candidate.account_key
    and existing.source = candidate.expected_source
    and existing.sync_key is not distinct from candidate.expected_sync_key
    and existing.ebay_item_id = candidate.expected_ebay_item_id
    and existing.ebay_sku is not distinct from candidate.expected_ebay_sku
    and existing.sync_generation = candidate.expected_sync_generation
    and existing.listing_status = 'ended';

  if v_post_create_count <> p_expected_create_count
    or v_post_stale_count <> p_expected_stale_count
    or exists (
      select 1
      from public.ebay_active_listings existing
      join jsonb_array_elements(p_create_candidates) candidate(value)
        on existing.ebay_item_id = candidate.value ->> 'ebay_item_id'
      group by candidate.value ->> 'ebay_item_id'
      having count(*) <> 1
    ) then
    raise exception 'EBAY_REGISTRY_REPAIR_AFFECTED_ROW_COUNT_MISMATCH'
      using errcode = 'P0001';
  end if;

  return query select
    'APPLIED'::text,
    v_create_inserted,
    v_stale_updated,
    0,
    0;
exception
  when invalid_text_representation or invalid_datetime_format then
    raise exception 'EBAY_REGISTRY_REPAIR_INPUT_INVALID'
      using errcode = 'P0001';
  when others then
    if sqlstate = 'P0001' and sqlerrm = any (array[
      'EBAY_REGISTRY_REPAIR_INPUT_INVALID',
      'EBAY_REGISTRY_REPAIR_COUNT_MISMATCH',
      'EBAY_REGISTRY_REPAIR_ACCOUNT_SCOPE_MISMATCH',
      'EBAY_REGISTRY_REPAIR_CREATE_ABSENCE_CAS_FAILED',
      'EBAY_REGISTRY_REPAIR_SYNC_KEY_COLLISION',
      'EBAY_REGISTRY_REPAIR_STALE_ROW_CAS_FAILED',
      'EBAY_REGISTRY_REPAIR_ACTION_SET_OVERLAP',
      'EBAY_REGISTRY_REPAIR_AFFECTED_ROW_COUNT_MISMATCH',
      'EBAY_REGISTRY_REPAIR_DATABASE_CONSTRAINT_FAILED',
      'EBAY_REGISTRY_REPAIR_RAW_PAYLOAD_UNSAFE'
    ]::text[]) then
      raise;
    end if;
    raise exception 'EBAY_REGISTRY_REPAIR_UNPROVEN'
      using errcode = 'P0001';
end;
$function$;

revoke all on function public.apply_ebay_registry_repair_v1(
  text, text, text, integer, integer, integer, jsonb, jsonb
) from public, anon, authenticated;

grant execute on function public.apply_ebay_registry_repair_v1(
  text, text, text, integer, integer, integer, jsonb, jsonb
) to service_role;

comment on function public.apply_ebay_registry_repair_v1(
  text, text, text, integer, integer, integer, jsonb, jsonb
) is
  'Atomically applies one server-approved account-scoped Registry CREATE_NEW and MARK_STALE tranche. The caller owns the immediate live eBay recheck; this RPC owns database absence/CAS, overlap, count, payload-safety, and rollback guarantees. It supports no repair, delete, historical, Product Case, or human-review mutation.';

notify pgrst, 'reload schema';
